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
  return typeof name === 'string' && name.trim() ? name.trim() : 'herramienta';
}

export function phaseLabel(phase: StreamPhase): string {
  switch (phase.kind) {
    case 'uploading':
      return phase.percent === null ? 'Subiendo adjuntos…' : `Subiendo adjuntos… ${phase.percent}%`;
    case 'waiting':
      return 'Esperando al servidor…';
    case 'thinking':
      return 'Pensando…';
    case 'reasoning':
      return 'Razonando…';
    case 'tool':
      return `Usando ${phase.name}…`;
    case 'approval':
      return 'Esperando tu decisión…';
    case 'writing':
      return 'Escribiendo…';
  }
}

export function statusLabel(status: StreamStatus): string {
  return status.slow ? 'La conexión parece lenta…' : phaseLabel(status.phase);
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
