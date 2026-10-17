import { HermesError } from '@/lib/hermes/errors';
import { sseEventName, type SseEvent } from '@/lib/hermes/sse';
import { strings } from '@/lib/i18n';

/**
 * Turnos por `/v1/runs`. A diferencia del stream de sesión, el run sigue en el servidor aunque se
 * corte la conexión que lee sus eventos (Android la corta al minimizar la app), y los eventos
 * se pueden volver a pedir desde el último `seq`.
 */

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** Orden del evento en el run; `null` en los que no lo traen (como `replay.truncated`). */
export function runEventSeq(event: SseEvent): number | null {
  const seq = event.data.seq;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}

export function isTerminalRunEvent(event: SseEvent): boolean {
  return TERMINAL_EVENTS.has(sseEventName(event));
}

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Traduce un evento de `/v1/runs` a los nombres del stream de sesión, que es lo que entiende el
 * chat. Los runs no mandan la lista de mensajes al terminar, solo `output`.
 */
export function toSessionEvent(event: SseEvent): SseEvent {
  const name = sseEventName(event);
  const data = event.data;
  switch (name) {
    case 'message.delta':
      return { event: 'assistant.delta', data };
    case 'message.interim':
      return { event: 'assistant.commentary', data };
    case 'tool.completed':
      return { event: data.error ? 'tool.failed' : 'tool.completed', data };
    case 'run.interrupted':
      // El gateway se reinició antes de que el run terminara.
      return { event: 'run.failed', data };
    case 'run.completed': {
      const output = typeof data.output === 'string' ? data.output : '';
      if (!output || Array.isArray(data.messages)) return { event: name, data };
      return { event: name, data: { ...data, messages: [{ role: 'assistant', content: output }] } };
    }
    default:
      return { event: name || null, data };
  }
}

/** Cómo terminó el seguimiento: con el evento final, o sin poder leerlo porque el servidor ya no guarda los eventos. */
export type RunWatchResult = 'ended' | 'expired';

type WatchOptions = {
  /** Abre el stream de eventos desde `lastSeq` (sin incluirlo); resuelve cuando el servidor lo cierra. */
  follow: (lastSeq: number, onEvent: (event: SseEvent) => void) => Promise<void>;
  onEvent: (event: SseEvent) => void;
  /**
   * Se cortó la conexión: resuelve `true` cuando vale la pena reconectar (por ejemplo, con la app
   * otra vez al frente) o `false` para rendirse con ese error.
   */
  waitToRetry: (error: unknown) => Promise<boolean>;
  /** Avisa que hubo que reconectar: lo mostrado puede no coincidir con lo que guardó el servidor. */
  onResume?: () => void;
  /** Cierres seguidos sin ningún evento nuevo antes de dar los eventos por perdidos. */
  maxEmptyCloses?: number;
};

/**
 * Sigue un run hasta su evento final. Si la conexión se cae, espera lo que diga `waitToRetry` y
 * reconecta desde el último `seq`, así no se repite ni se pierde texto.
 */
export async function watchRun({
  follow,
  onEvent,
  waitToRetry,
  onResume,
  maxEmptyCloses = 3,
}: WatchOptions): Promise<RunWatchResult> {
  let lastSeq = -1;
  let ended = false;
  let emptyCloses = 0;
  let first = true;

  for (;;) {
    let received = false;
    if (!first) onResume?.();
    first = false;
    try {
      await follow(lastSeq, (event) => {
        const seq = runEventSeq(event);
        if (seq !== null) {
          if (seq <= lastSeq) return;
          lastSeq = seq;
        }
        received = true;
        if (isTerminalRunEvent(event)) ended = true;
        onEvent(toSessionEvent(event));
      });
      if (ended) return 'ended';
      // El servidor cerró sin el evento final (por ejemplo, porque el lector iba lento).
      emptyCloses = received ? 0 : emptyCloses + 1;
      if (emptyCloses >= maxEmptyCloses) return 'expired';
    } catch (error) {
      if (ended) return 'ended';
      if (error instanceof HermesError && error.code === 'aborted') throw error;
      // Pasado un rato sin nadie leyendo, Hermes descarta los eventos (el run sigue igual).
      if (error instanceof HermesError && error.code === 'not_found') return 'expired';
      if (!(await waitToRetry(error))) throw error;
    }
  }
}

/** Repite `run` mientras falle y `waitToRetry` diga que vale la pena. */
export async function withRetry<T>(
  run: () => Promise<T>,
  waitToRetry: (error: unknown) => Promise<boolean>,
): Promise<T> {
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HermesError && error.code === 'aborted') throw error;
      if (!(await waitToRetry(error))) throw error;
    }
  }
}

type SettleOptions<T extends { status: string }> = {
  getState: () => Promise<T>;
  waitToRetry: (error: unknown) => Promise<boolean>;
  /** Espera entre consultas mientras el run sigue. */
  sleep: () => Promise<void>;
  signal?: AbortSignal;
};

/** Consulta el estado del run hasta que termine; para cuando ya no hay eventos que leer. */
export async function waitForRunEnd<T extends { status: string }>({
  getState,
  waitToRetry,
  sleep,
  signal,
}: SettleOptions<T>): Promise<T> {
  for (;;) {
    const state = await withRetry(getState, waitToRetry);
    if (isTerminalRunStatus(state.status)) return state;
    if (signal?.aborted) throw new HermesError('aborted', strings().errors.cancelled);
    await sleep();
  }
}
