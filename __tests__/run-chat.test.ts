import { HermesClient } from '@/lib/hermes/client';
import { normalizeRunEvent, runEventSeq } from '@/lib/hermes/run-events';
import { sseEventName, type SseEvent } from '@/lib/hermes/sse';

const encoder = new TextEncoder();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Frames como los de Hermes: `id:` con el número y el nombre dentro de `data.event`. */
function sse(frames: Record<string, unknown>[]): Response {
  const text = frames.map((frame) => `id: ${frame.seq}\ndata: ${JSON.stringify(frame)}\n\n`).join('');
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`: open\n\n${text}`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function client(fetchImpl: jest.Mock) {
  return new HermesClient({
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'mock-test-key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

type Call = [string, RequestInit | undefined];

function header(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

describe('eventos de /v1/runs', () => {
  it('se traducen al vocabulario del stream de sesión', () => {
    const names = (data: Record<string, unknown>) =>
      normalizeRunEvent({ event: null, data }).map((event) => [sseEventName(event), event.data]);
    expect(names({ event: 'message.delta', delta: 'Ho' })).toEqual([['assistant.delta', { event: 'message.delta', delta: 'Ho' }]]);
    expect(names({ event: 'tool.started', tool: 'terminal' })[0]?.[1]).toMatchObject({ tool_name: 'terminal' });
    expect(names({ event: 'tool.completed', tool: 'terminal', error: true })[0]?.[0]).toBe('tool.failed');
    expect(names({ event: 'message.interim', text: 'Miro…' })[0]?.[0]).toBe('assistant.commentary');
    expect(names({ event: 'run.completed', output: 'Listo.' }).map(([name]) => name)).toEqual([
      'assistant.completed',
      'run.completed',
    ]);
    expect(names({ event: 'run.completed', output: 'Listo.' })[0]?.[1]).toMatchObject({ content: 'Listo.' });
    expect(names({ event: 'run.interrupted' })[0]?.[0]).toBe('run.cancelled');
    expect(names({ event: 'approval.request', choices: ['once'] })[0]?.[0]).toBe('approval.request');
  });

  it('leen el número del evento del cuerpo o de la línea id', () => {
    expect(runEventSeq({ event: null, data: { seq: 4 } })).toBe(4);
    expect(runEventSeq({ event: null, data: {}, id: '7' })).toBe(7);
    expect(runEventSeq({ event: null, data: {} })).toBeNull();
  });
});

describe('turno por /v1/runs', () => {
  it('crea el turno en la conversación y sigue sus eventos', async () => {
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run_1', status: 'started' });
      return sse([
        { event: 'message.delta', run_id: 'run_1', delta: 'Lis', seq: 0 },
        { event: 'run.completed', run_id: 'run_1', output: 'Listo.', seq: 1 },
      ]);
    });
    const events: SseEvent[] = [];
    const onOpen = jest.fn();
    await client(fetchImpl).runChat(
      'sess_1',
      'hola',
      { providerId: 'deepseek', modelId: 'deepseek-v4' },
      (event) => events.push(event),
      undefined,
      { onOpen },
    );
    expect(events.map(sseEventName)).toEqual(['run.accepted', 'assistant.delta', 'assistant.completed', 'run.completed']);
    expect(events[0]?.data.run_id).toBe('run_1');
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [postUrl, post] = fetchImpl.mock.calls[0] as Call;
    expect(postUrl).toBe('http://127.0.0.1:8642/v1/runs');
    expect(JSON.parse(String(post?.body))).toEqual({
      input: 'hola',
      session_id: 'sess_1',
      provider: 'deepseek',
      model: 'deepseek-v4',
    });
    expect(header(post, 'Idempotency-Key')).toMatch(/^hm-/);
    expect((fetchImpl.mock.calls[1] as Call)[0]).toBe('http://127.0.0.1:8642/v1/runs/run_1/events');
  });

  it('reintenta el alta con la misma clave si se pierde la conexión', async () => {
    let posts = 0;
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) {
        posts += 1;
        if (posts === 1) throw new TypeError('Network request failed');
        return json(202, { run_id: 'run_1', status: 'started', replayed: true });
      }
      return sse([{ event: 'run.completed', run_id: 'run_1', output: 'Listo.', seq: 0 }]);
    });
    await client(fetchImpl).runChat('sess_1', 'hola', null, () => undefined);
    const keys = (fetchImpl.mock.calls as Call[])
      .filter(([url]) => url.endsWith('/v1/runs'))
      .map(([, init]) => header(init, 'Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('se reconecta desde el último evento sin repetir lo ya recibido', async () => {
    let gets = 0;
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run_1', status: 'started' });
      gets += 1;
      // El primer stream se corta sin el evento final.
      if (gets === 1) return sse([{ event: 'message.delta', run_id: 'run_1', delta: 'Lis', seq: 0 }]);
      return sse([
        { event: 'message.delta', run_id: 'run_1', delta: 'Lis', seq: 0 },
        { event: 'message.delta', run_id: 'run_1', delta: 'to.', seq: 1 },
        { event: 'run.completed', run_id: 'run_1', output: 'Listo.', seq: 2 },
      ]);
    });
    const deltas: string[] = [];
    await client(fetchImpl).runChat('sess_1', 'hola', null, (event) => {
      if (sseEventName(event) === 'assistant.delta') deltas.push(String(event.data.delta));
    });
    expect(deltas).toEqual(['Lis', 'to.']);
    const [, second] = fetchImpl.mock.calls[2] as Call;
    expect(header(second, 'Last-Event-ID')).toBe('0');
  });

  it('espera el estado final si Hermes ya no guarda el stream', async () => {
    let polls = 0;
    const fetchImpl = jest.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run_1', status: 'started' });
      if (url.endsWith('/events')) return json(404, { error: { message: 'Run not found: run_1' } });
      polls += 1;
      return json(200, {
        object: 'hermes.run',
        run_id: 'run_1',
        status: polls === 1 ? 'running' : 'completed',
        output: 'Listo.',
        pending_steer: 'usá docs',
      });
    });
    const events: SseEvent[] = [];
    await client(fetchImpl).runChat('sess_1', 'hola', null, (event) => events.push(event));
    expect(events.map(sseEventName)).toEqual(['run.accepted', 'assistant.completed', 'run.completed']);
    expect(events[2]?.data.pending_steer).toBe('usá docs');
  }, 10_000);

  it('corta y reabre la conexión cuando se pide, sin cancelar el turno', async () => {
    let gets = 0;
    let reconnect: (() => void) | undefined;
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run_1', status: 'started' });
      gets += 1;
      if (gets === 1) {
        // Un stream que no avanza, como un socket muerto tras volver de segundo plano.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          setTimeout(() => reconnect?.(), 10);
        });
      }
      return sse([{ event: 'run.completed', run_id: 'run_1', output: 'Listo.', seq: 0 }]);
    });
    const events: string[] = [];
    await client(fetchImpl).runChat('sess_1', 'hola', null, (event) => events.push(sseEventName(event)), undefined, {
      onReconnectable: (next) => {
        reconnect = next;
      },
    });
    expect(gets).toBe(2);
    expect(events.at(-1)).toBe('run.completed');
  });

  it('informa la cancelación del usuario', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/runs')) return json(202, { run_id: 'run_1', status: 'started' });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        setTimeout(() => controller.abort(), 10);
      });
    });
    await expect(
      client(fetchImpl).runChat('sess_1', 'hola', null, () => undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});
