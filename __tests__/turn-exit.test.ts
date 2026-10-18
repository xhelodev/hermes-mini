import { strings } from '@/lib/i18n';
import { runFailureMessage } from '@/lib/stream-progress';
import { exitReasonMessage, failureText } from '@/lib/turn-exit';

describe('motivos de salida de un turno', () => {
  it('explica los motivos y descarta los detalles', () => {
    expect(exitReasonMessage('max_iterations_reached(30/30)')).toBe(strings().turnExit.maxSteps);
    expect(exitReasonMessage('repeated_outer_errors(clave inválida)')).toBe(strings().turnExit.errors);
    expect(exitReasonMessage('guardrail_halt')).toBe(strings().turnExit.guardrail);
    expect(exitReasonMessage('algo_nuevo(detalle)')).toBe(strings().turnExit.other('algo_nuevo'));
    expect(exitReasonMessage('')).toBe(strings().chat.runFailed);
  });

  it('prefiere el error del servidor al motivo de salida', () => {
    expect(failureText('Sin crédito', 'budget_exhausted')).toBe('Sin crédito');
    expect(failureText('', 'budget_exhausted')).toBe(strings().turnExit.budget);
    expect(failureText('', '')).toBe(strings().chat.runFailed);
  });

  it('usa el motivo de salida de run.failed', () => {
    expect(runFailureMessage('run.failed', { completed: false, turn_exit_reason: 'context_compression_timeout' })).toBe(
      strings().turnExit.context,
    );
    expect(runFailureMessage('run.failed', { error: 'Límite' })).toBe('Límite');
  });
});
