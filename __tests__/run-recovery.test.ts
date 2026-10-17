import { HermesError } from '@/lib/hermes/errors';
import { mapRun, type HermesRun } from '@/lib/hermes/map';
import { strings } from '@/lib/i18n';
import { exitReasonMessage, failureText, recoveryError, recoveryOf, settleRun } from '@/lib/run-recovery';
import { runFailureMessage } from '@/lib/stream-progress';

function run(status: string, extra: Partial<HermesRun> = {}): HermesRun {
  return mapRun({ run_id: 'run_1', status, ...extra }) as HermesRun;
}

describe('estado de un turno', () => {
  it('lee el estado que devuelve Hermes', () => {
    expect(
      mapRun({
        object: 'hermes.run',
        run_id: 'run_1',
        status: 'failed',
        output: '',
        turn_exit_reason: 'max_iterations_reached(30/30)',
      }),
    ).toEqual({
      id: 'run_1',
      status: 'failed',
      finished: true,
      output: '',
      error: '',
      exitReason: 'max_iterations_reached(30/30)',
    });
    expect(mapRun({ run_id: 'run_1', status: 'running' })?.finished).toBe(false);
    expect(mapRun({ run_id: 'run_1', status: 'waiting_for_approval' })?.finished).toBe(false);
    expect(mapRun({ status: 'running' })).toBeNull();
  });

  it('explica los motivos de salida y descarta los detalles', () => {
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
  });

  it('decide qué avisar según cómo terminó', () => {
    expect(recoveryOf(run('running'))).toBeNull();
    expect(recoveryOf(run('completed'))).toEqual({ kind: 'done' });
    expect(recoveryOf(run('cancelled'))).toEqual({ kind: 'cut' });
    expect(recoveryOf(run('interrupted'))).toEqual({ kind: 'cut' });
    expect(recoveryOf(run('failed', { error: 'Se cayó' }))).toEqual({ kind: 'failed', message: 'Se cayó' });
    expect(recoveryError({ kind: 'cut' })).toBe(strings().chat.cutInBackground);
    expect(recoveryError({ kind: 'done' })).toBeNull();
    expect(recoveryError({ kind: 'unknown' })).toBeNull();
  });
});

describe('esperar un turno cortado', () => {
  const sleep = jest.fn(async () => undefined);

  it('espera mientras sigue en curso', async () => {
    const getRun = jest
      .fn()
      .mockResolvedValueOnce(run('running'))
      .mockRejectedValueOnce(new HermesError('down', 'sin red'))
      .mockResolvedValueOnce(run('completed'));
    await expect(settleRun(getRun, 'run_1', { keepWaiting: () => true, sleep })).resolves.toEqual({ kind: 'done' });
    expect(getRun).toHaveBeenCalledTimes(3);
  });

  it('se rinde si el servidor ya no tiene el turno', async () => {
    const getRun = jest.fn().mockRejectedValue(new HermesError('not_found', 'Run not found', 404));
    await expect(settleRun(getRun, 'run_1', { keepWaiting: () => true, sleep })).resolves.toEqual({ kind: 'unknown' });
    expect(getRun).toHaveBeenCalledTimes(1);
  });

  it('no pregunta sin run_id y corta si el usuario se va', async () => {
    const getRun = jest.fn().mockResolvedValue(run('running'));
    await expect(settleRun(getRun, null, { keepWaiting: () => true, sleep })).resolves.toEqual({ kind: 'unknown' });
    await expect(settleRun(getRun, 'run_1', { keepWaiting: () => false, sleep })).resolves.toEqual({ kind: 'unknown' });
    expect(getRun).not.toHaveBeenCalled();
  });

  it('deja de esperar al vencer el plazo', async () => {
    let clock = 0;
    const getRun = jest.fn().mockResolvedValue(run('running'));
    const outcome = await settleRun(getRun, 'run_1', {
      keepWaiting: () => true,
      maxMs: 10_000,
      pollMs: 3_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(outcome).toEqual({ kind: 'unknown' });
    expect(getRun).toHaveBeenCalledTimes(5);
  });
});
