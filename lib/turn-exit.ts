import { strings } from '@/lib/i18n';

type ExitFamily = keyof Omit<ReturnType<typeof strings>['turnExit'], 'other'>;

/** Familias de `turn_exit_reason` con texto propio; el resto muestra el código. */
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
