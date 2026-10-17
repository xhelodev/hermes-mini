import { HermesError } from '@/lib/hermes/errors';
import { toSessionEvent, waitForRunEnd, watchRun, withRetry } from '@/lib/hermes/runs';
import { sseEventName, type SseEvent } from '@/lib/hermes/sse';

function runEvent(event: string, seq: number, fields: Record<string, unknown> = {}): SseEvent {
  return { event: null, data: { event, run_id: 'run_1', seq, ...fields } };
}

const down = () => new HermesError('down', 'No se pudo conectar con el servidor.');

describe('eventos de /v1/runs', () => {
  it('lee el nombre del JSON, porque los runs no mandan la línea event:', () => {
    expect(sseEventName(runEvent('message.delta', 0))).toBe('message.delta');
  });

  it('los traduce a los nombres del stream de sesión', () => {
    expect(toSessionEvent(runEvent('message.delta', 0, { delta: 'Ho' })).event).toBe('assistant.delta');
    expect(toSessionEvent(runEvent('message.interim', 1, { text: 'Miro…' })).event).toBe('assistant.commentary');
    expect(toSessionEvent(runEvent('tool.completed', 2, { tool: 'terminal', error: true })).event).toBe('tool.failed');
    expect(toSessionEvent(runEvent('tool.completed', 3, { tool: 'terminal', error: false })).event).toBe('tool.completed');
    expect(toSessionEvent(runEvent('run.interrupted', 4)).event).toBe('run.failed');
    expect(toSessionEvent(runEvent('reasoning.available', 5, { text: 'mmm' })).event).toBe('reasoning.available');
  });

  it('arma la respuesta final con `output`, que es lo único que trae el run', () => {
    const done = toSessionEvent(runEvent('run.completed', 9, { output: 'Listo.' }));
    expect(done.event).toBe('run.completed');
    expect(done.data.messages).toEqual([{ role: 'assistant', content: 'Listo.' }]);
  });
});

describe('seguir un run', () => {
  it('reconecta desde el último seq sin repetir ni perder texto', async () => {
    const calls: number[] = [];
    const follow = jest.fn(async (lastSeq: number, onEvent: (event: SseEvent) => void) => {
      calls.push(lastSeq);
      if (calls.length === 1) {
        onEvent(runEvent('message.delta', 0, { delta: 'Ho' }));
        onEvent(runEvent('message.delta', 1, { delta: 'la' }));
        throw down();
      }
      // El servidor manda desde lastSeq + 1; si repitiera alguno, se descarta.
      onEvent(runEvent('message.delta', 1, { delta: 'la' }));
      onEvent(runEvent('message.delta', 2, { delta: '!' }));
      onEvent(runEvent('run.completed', 3, { output: 'Hola!' }));
    });
    const seen: string[] = [];
    const onResume = jest.fn();
    const result = await watchRun({
      follow,
      onEvent: (event) => {
        if (event.event === 'assistant.delta') seen.push(String(event.data.delta));
      },
      waitToRetry: async () => true,
      onResume,
    });
    expect(result).toBe('ended');
    expect(calls).toEqual([-1, 1]);
    expect(seen.join('')).toBe('Hola!');
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('se rinde con el error si no vale la pena reintentar', async () => {
    const follow = jest.fn(async () => {
      throw down();
    });
    await expect(watchRun({ follow, onEvent: () => undefined, waitToRetry: async () => false })).rejects.toMatchObject({
      code: 'down',
    });
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it('no reintenta si el usuario canceló', async () => {
    const waitToRetry = jest.fn(async () => true);
    const follow = jest.fn(async () => {
      throw new HermesError('aborted', 'Cancelado.');
    });
    await expect(watchRun({ follow, onEvent: () => undefined, waitToRetry })).rejects.toMatchObject({ code: 'aborted' });
    expect(waitToRetry).not.toHaveBeenCalled();
  });

  it('da los eventos por perdidos si Hermes ya no los guarda', async () => {
    const follow = jest.fn(async () => {
      throw new HermesError('not_found', 'Run not found');
    });
    await expect(watchRun({ follow, onEvent: () => undefined, waitToRetry: async () => true })).resolves.toBe('expired');
  });

  it('da los eventos por perdidos si el servidor cierra varias veces sin mandar nada', async () => {
    const follow = jest.fn(async () => undefined);
    await expect(
      watchRun({ follow, onEvent: () => undefined, waitToRetry: async () => true, maxEmptyCloses: 2 }),
    ).resolves.toBe('expired');
    expect(follow).toHaveBeenCalledTimes(2);
  });

  it('termina bien si la conexión se corta justo después del evento final', async () => {
    const follow = jest.fn(async (_lastSeq: number, onEvent: (event: SseEvent) => void) => {
      onEvent(runEvent('run.completed', 0, { output: 'Listo.' }));
      throw down();
    });
    await expect(watchRun({ follow, onEvent: () => undefined, waitToRetry: async () => false })).resolves.toBe('ended');
  });
});

describe('reintentos y estado del run', () => {
  it('reintenta mientras falle y valga la pena', async () => {
    let attempts = 0;
    const run = jest.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw down();
      return 'run_1';
    });
    await expect(withRetry(run, async () => true)).resolves.toBe('run_1');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('consulta el estado hasta que el run termina', async () => {
    const states = ['running', 'running', 'completed'];
    const sleep = jest.fn(async () => undefined);
    const state = await waitForRunEnd({
      getState: async () => ({ status: states.shift() ?? 'completed', output: 'Listo.' }),
      waitToRetry: async () => true,
      sleep,
    });
    expect(state).toEqual({ status: 'completed', output: 'Listo.' });
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
