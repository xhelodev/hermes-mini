import { strings } from '@/lib/i18n';

/** En qué está la respuesta en curso, para decirle al usuario qué pasa mientras espera. */
export type StreamPhase =
  | { kind: 'uploading'; percent: number | null }
  | { kind: 'waiting' }
  | { kind: 'thinking' }
  | { kind: 'reasoning' }
  | { kind: 'tool'; name: string }
  | { kind: 'approval' }
  | { kind: 'writing' };

/** Etapa actual, desde cuándo y si el servidor lleva un rato sin mandar nada. */
export type StreamStatus = { phase: StreamPhase; since: number; slow: boolean };

/** Sin bytes del servidor (ni keepalive) durante este tiempo, avisamos que la conexión está lenta. */
export const STREAM_SLOW_MS = 30_000;
/** Sin bytes durante este tiempo damos la conexión por perdida. */
export const STREAM_DEAD_MS = 120_000;
/** Antes de esto no mostramos el tiempo transcurrido: una espera corta no necesita contador. */
const ELAPSED_AFTER_MS = 5_000;

export function toolNameOf(data: Record<string, unknown>): string {
  const name = data.tool_name ?? data.tool;
  return typeof name === 'string' && name.trim() ? name.trim() : strings().stream.tool;
}

export function phaseLabel(phase: StreamPhase): string {
  const text = strings().stream;
  switch (phase.kind) {
    case 'uploading':
      return phase.percent === null ? text.uploading : text.uploadingPercent(phase.percent);
    case 'waiting':
      return text.waiting;
    case 'thinking':
      return text.thinking;
    case 'reasoning':
      return text.reasoning;
    case 'tool':
      return text.usingTool(phase.name);
    case 'approval':
      return text.approval;
    case 'writing':
      return text.writing;
  }
}

export function statusLabel(status: StreamStatus): string {
  return status.slow ? strings().stream.slow : phaseLabel(status.phase);
}

/** Etapa a la que pasa la respuesta con este evento del stream; `null` si no cambia. */
export function phaseAfterEvent(name: string, data: Record<string, unknown>): StreamPhase | null {
  switch (name) {
    case 'assistant.delta':
      return { kind: 'writing' };
    case 'reasoning.delta':
      return { kind: 'reasoning' };
    case 'tool.started':
      return { kind: 'tool', name: toolNameOf(data) };
    case 'tool.completed':
    case 'tool.failed':
      return { kind: 'thinking' };
    case 'approval.request':
      return { kind: 'approval' };
    default:
      return null;
  }
}

/**
 * Pasa a la etapa indicada. Si es la misma devuelve el mismo objeto (React no vuelve a
 * pintar), y el avance de una subida conserva el reloj de la etapa.
 */
export function advanceStatus(current: StreamStatus | null, phase: StreamPhase, now: number): StreamStatus {
  if (current && phaseLabel(current.phase) === phaseLabel(phase)) return current;
  if (current?.phase.kind === 'uploading' && phase.kind === 'uploading') return { ...current, phase };
  return { phase, since: now, slow: current?.slow ?? false };
}

/** Tiempo transcurrido para mostrar al lado de la etapa; `null` mientras la espera es corta. */
export function elapsedLabel(ms: number): string | null {
  if (ms < ELAPSED_AFTER_MS) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** Qué hacer cuando el stream termina por error, según por qué se cortó. */
export type StreamStop = {
  /** Mensaje de error a mostrar; `null` si no hay nada que avisar como fallo. */
  message: string | null;
  /** La respuesta sigue corriendo en el servidor: conviene recargar para traer el resultado. */
  recover: boolean;
};

/**
 * Texto del fallo si el evento termina el turno con error; `null` si no es un fallo. Hermes
 * manda `run.failed` cuando el agente no termina, y `error` (sin `run.failed`) si se cae.
 */
export function runFailureMessage(name: string, data: Record<string, unknown>): string | null {
  if (name !== 'run.failed' && name !== 'error') return null;
  const raw = name === 'error' ? data.message : data.error;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string' && raw.message.trim()) {
    return raw.message;
  }
  return strings().chat.runFailed;
}

/**
 * Decide cómo cerrar un turno que lanzó. El orden importa: un corte por reloj (`lost`) o una
 * cancelación del usuario (`aborted`) mandan sobre el hecho de haber minimizado la app, porque
 * en esos dos casos no tiene sentido recuperar nada.
 */
export function stopReason(opts: {
  /** El vigía dio la conexión por perdida (el servidor dejó de mandar). */
  lost: boolean;
  /** El usuario canceló el turno. */
  aborted: boolean;
  /** La app pasó a segundo plano durante el turno: el sistema pudo cortar el socket. */
  backgrounded: boolean;
  /** Texto para un error común, solo se evalúa si hace falta. */
  describe: () => string;
}): StreamStop {
  if (opts.lost) {
    return { message: strings().chat.connectionLost, recover: false };
  }
  if (opts.aborted) return { message: null, recover: false };
  // Minimizar la app corta el socket, pero el servidor sigue con el turno: no es un fallo.
  if (opts.backgrounded) return { message: null, recover: true };
  return { message: opts.describe(), recover: false };
}

export type StreamWatchdog = {
  /** Llegaron datos del servidor. */
  touch: () => void;
  /** Deja de vigilar, por ejemplo mientras el agente espera una aprobación. */
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

type WatchdogOptions = {
  slowMs?: number;
  deadMs?: number;
  checkMs?: number;
  onSlow: (slow: boolean) => void;
  onDead: () => void;
};

/**
 * Vigila que el stream siga vivo. `touch` solo anota la hora (se llama con cada chunk) y un
 * único intervalo compara contra ella.
 */
export function createStreamWatchdog({
  slowMs = STREAM_SLOW_MS,
  deadMs = STREAM_DEAD_MS,
  checkMs = 1000,
  onSlow,
  onDead,
}: WatchdogOptions): StreamWatchdog {
  let last = Date.now();
  let paused = false;
  let slow = false;
  let timer: ReturnType<typeof setInterval> | null = setInterval(check, checkMs);

  function setSlow(next: boolean) {
    if (slow === next || !timer) return;
    slow = next;
    onSlow(next);
  }

  function check() {
    if (paused) return;
    const idle = Date.now() - last;
    if (idle >= deadMs) {
      stop();
      onDead();
      return;
    }
    setSlow(idle >= slowMs);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    touch() {
      last = Date.now();
      setSlow(false);
    },
    pause() {
      paused = true;
      setSlow(false);
    },
    resume() {
      paused = false;
      last = Date.now();
    },
    stop,
  };
}
