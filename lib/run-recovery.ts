import { HermesError } from '@/lib/hermes/errors';
import type { HermesRun } from '@/lib/hermes/map';
import { strings } from '@/lib/i18n';

/** Familias de `turn_exit_reason` con texto propio; el resto muestra el código. */
type ExitFamily = keyof Omit<ReturnType<typeof strings>['turnExit'], 'other'>;

const EXIT_FAMILIES: Record<string, ExitFamily> = {
  max_iterations_reached: 'maxSteps',
  error_near_max_iterations: 'maxSteps',
  budget_exhausted: 'budget',
  review_input_budget_exhausted: 'budget',
  context_compression_timeout: 'context',
  context_compression_exhausted: 'context',
  ollama_runtime_context_too_small: 'context',
  all_retries_exhausted_no_response: 'noResponse',
  empty_response_exhausted: 'noResponse',
  repeated_outer_errors: 'errors',
  local_processing_error: 'errors',
  redirect_restart_limit_exceeded: 'errors',
  rebuilt_restart_limit_exceeded: 'errors',
  guardrail_halt: 'guardrail',
  interrupted_by_system: 'interrupted',
  interpreter_shutdown: 'interrupted',
  session_persistence_failed: 'notSaved',
};

/**
 * Explica un `turn_exit_reason`. Hermes agrega detalles entre paréntesis
 * (`max_iterations_reached(30/30)`, a veces el texto de un error): se descartan.
 */
export function exitReasonMessage(reason: string): string {
  const code = reason.split('(')[0]?.trim() ?? '';
  if (!code) return strings().chat.runFailed;
  const text = strings().turnExit;
  const family = EXIT_FAMILIES[code];
  return family ? text[family] : text.other(code);
}

/** El error del servidor si lo hay; si no, el motivo de salida; si no, un texto genérico. */
export function failureText(error: string, exitReason: string): string {
  if (error.trim()) return error;
  if (exitReason.trim()) return exitReasonMessage(exitReason);
  return strings().chat.runFailed;
}

/** En qué quedó un turno cuyo stream se cortó. */
export type RunRecovery =
  /** Terminó bien: alcanza con traer los mensajes. */
  | { kind: 'done' }
  /** Hermes lo detuvo, por lo general porque se enteró del corte. */
  | { kind: 'cut' }
  | { kind: 'failed'; message: string }
  /** Sin datos: el estado venció, el servidor se reinició o no hubo `run_id`. */
  | { kind: 'unknown' };

/** Traduce el estado de un turno; `null` mientras siga en curso. */
export function recoveryOf(run: HermesRun): RunRecovery | null {
  if (!run.finished) return null;
  if (run.status === 'completed') return { kind: 'done' };
  if (run.status === 'failed') return { kind: 'failed', message: failureText(run.error, run.exitReason) };
  return { kind: 'cut' };
}

/** Qué decirle al usuario después de recuperar el turno; `null` si no hay nada que avisar. */
export function recoveryError(outcome: RunRecovery): string | null {
  if (outcome.kind === 'cut') return strings().chat.cutInBackground;
  if (outcome.kind === 'failed') return outcome.message;
  return null;
}

/** Cada cuánto preguntamos por un turno que sigue en curso. */
export const RUN_POLL_MS = 3_000;
/** Después de esto dejamos de esperar y mostramos lo que haya guardado. */
export const RUN_RECOVERY_MAX_MS = 10 * 60_000;

type SettleOptions = {
  /** Si devuelve `false` se deja de esperar (salió del chat o detuvo el turno). */
  keepWaiting: () => boolean;
  pollMs?: number;
  maxMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Pregunta por el turno hasta que termine. Los errores de red no cortan la espera (la app
 * puede estar volviendo de segundo plano sin conexión todavía); un 404 sí, porque el
 * servidor ya no tiene ese turno.
 */
export async function settleRun(
  getRun: (runId: string) => Promise<HermesRun>,
  runId: string | null,
  options: SettleOptions,
): Promise<RunRecovery> {
  if (!runId) return { kind: 'unknown' };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + (options.maxMs ?? RUN_RECOVERY_MAX_MS);
  while (options.keepWaiting()) {
    try {
      const outcome = recoveryOf(await getRun(runId));
      if (outcome) return outcome;
    } catch (error) {
      if (error instanceof HermesError && error.code === 'not_found') return { kind: 'unknown' };
    }
    if (now() >= deadline) break;
    await sleep(options.pollMs ?? RUN_POLL_MS);
  }
  return { kind: 'unknown' };
}
