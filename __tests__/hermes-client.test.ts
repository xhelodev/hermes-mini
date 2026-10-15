import { HermesClient } from '@/lib/hermes/client';
import { HermesError } from '@/lib/hermes/errors';
import {
  finalAssistantReply,
  formatSessionTime,
  mapJob,
  mapJobs,
  mapMessages,
  mapModelOptions,
  mapSession,
  mapSessions,
  mapSkills,
  mapToolsets,
  sourceLabel,
} from '@/lib/hermes/map';
import { pushSseChunk, sseEventName } from '@/lib/hermes/sse';
import { normalizeBaseUrl } from '@/lib/hermes/url';

describe('URL del API de Hermes', () => {
  it('normaliza el origen y quita el sufijo /v1', () => {
    expect(normalizeBaseUrl('https://hermes.tail1234.ts.net/v1/')).toBe(
      'https://hermes.tail1234.ts.net',
    );
    expect(normalizeBaseUrl('hermes.local:8642')).toBe('https://hermes.local:8642');
  });

  it('rechaza una URL vacía', () => {
    expect(() => normalizeBaseUrl('  ')).toThrow(HermesError);
  });
});

describe('parser SSE', () => {
  it('ignora keepalive y emite el delta', () => {
    const first = pushSseChunk('', 'event: assistant.delta\ndata: {"delta":"Hola"}\n\n: keepalive\n\n');
    expect(first.events).toHaveLength(1);
    expect(sseEventName(first.events[0]!)).toBe('assistant.delta');
    expect(first.events[0]?.data.delta).toBe('Hola');

    const second = pushSseChunk(first.buffer, 'event: run.completed\ndata: {"status":"completed"}\n\n');
    expect(sseEventName(second.events[0]!)).toBe('run.completed');
  });
});

describe('mapeo de sesiones', () => {
  it('lee la lista real y marca Telegram', () => {
    const sessions = mapSessions({
      object: 'list',
      data: [
        {
          id: 'tg-1',
          title: 'Notas',
          source: 'telegram',
          preview: 'Mandame el resumen',
          last_active: 1_700_000_000,
          archived: false,
        },
        {
          id: 'old',
          title: 'Archivada',
          source: 'cli',
          archived: true,
          last_active: 1_800_000_000,
        },
      ],
    });

    expect(sessions.map((session) => session.id)).toEqual(['tg-1']);
    expect(sessions[0]?.endReason).toBeNull();
    expect(sourceLabel(sessions[0]?.source ?? null)).toBe('Telegram');
    expect(sessions[0]?.updatedAt).toBe(1_700_000_000_000);
  });

  it('acepta la sesión envuelta que devuelve el alta', () => {
    expect(
      mapSession({
        object: 'hermes.session',
        session: { id: 'api_1', title: 'Nueva', source: 'api_server' },
      })?.id,
    ).toBe('api_1');
  });

  it('lee mensajes con contenido en partes', () => {
    const messages = mapMessages({
      data: [
        {
          id: 'm1',
          role: 'user',
          content: [{ type: 'text', text: 'Hola' }, { type: 'image_url', image_url: { url: 'x' } }],
        },
      ],
    });
    expect(messages[0]?.text).toBe('Hola\n[imagen]');
    expect(messages[0]?.reasoning).toBe('');
    expect(messages[0]?.attachments).toEqual([{ kind: 'image', label: 'Imagen', url: 'x' }]);
  });

  it('deja el razonamiento fuera del texto', () => {
    const messages = mapMessages({
      data: [
        {
          id: 'm2',
          role: 'assistant',
          reasoning_content: 'Primero miro el archivo.',
          content: [
            { type: 'reasoning', text: 'Primero miro el archivo.' },
            { type: 'thinking', text: 'Después comparo.' },
            { type: 'commentary', text: 'Sigo con la respuesta.' },
            { type: 'text', text: 'Listo.' },
            { type: 'image_url', image_url: { url: 'x' } },
          ],
        },
      ],
    });
    expect(messages[0]?.text).toBe('Listo.\n[imagen]');
    expect(messages[0]?.reasoning).toBe('Primero miro el archivo.\n\nDespués comparo.');
  });

  it('trata output_text como respuesta y no como razonamiento', () => {
    const messages = mapMessages({
      data: [
        {
          id: 'm3',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Armo la tabla.' },
            { type: 'output_text', text: '| A | B |\n|---|---|\n| 1 | 2 |' },
          ],
        },
      ],
    });
    expect(messages[0]?.text).toBe('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(messages[0]?.reasoning).toBe('Armo la tabla.');
  });

  it('muestra el rechazo del modelo y lee el resumen de razonamiento de Responses', () => {
    const messages = mapMessages({
      data: [
        {
          id: 'm4',
          role: 'assistant',
          content: [
            { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Evalúo el pedido.' }] },
            { type: 'refusal', refusal: 'No puedo ayudar con eso.' },
          ],
        },
      ],
    });
    expect(messages[0]?.text).toBe('No puedo ayudar con eso.');
    expect(messages[0]?.reasoning).toBe('Evalúo el pedido.');
  });

  it('toma la respuesta final del último mensaje del asistente en run.completed', () => {
    const reply = finalAssistantReply([
      { role: 'user', content: 'listá los archivos' },
      { role: 'assistant', content: 'Voy a listar los archivos.', reasoning: 'Uso ls.' },
      { role: 'tool', content: '{"files":["a.ts"]}' },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hay un archivo: a.ts.' }],
        reasoning_content: 'Resumo el resultado.',
      },
      { role: 'assistant', content: '' },
    ]);
    expect(reply.text).toBe('Hay un archivo: a.ts.');
    expect(reply.reasoning).toBe('Uso ls.\n\nResumo el resultado.');
    expect(finalAssistantReply(undefined)).toEqual({ text: '', reasoning: '' });
  });

  it('ignora turnos anteriores si run.completed trae el historial completo', () => {
    const reply = finalAssistantReply([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola.', reasoning: 'Saludo.' },
      { role: 'user', content: 'dame una tabla' },
      { role: 'assistant', content: '| A |\n|---|\n| 1 |' },
    ]);
    expect(reply).toEqual({ text: '| A |\n|---|\n| 1 |', reasoning: '' });
  });

  it('oculta la conversación que se ramificó', () => {
    const sessions = mapSessions({
      data: [
        { id: 'old', title: 'Original', end_reason: 'branched' },
        { id: 'copy', title: 'Original (copia)' },
      ],
    });
    expect(sessions.map((session) => session.id)).toEqual(['copy']);
  });

  it('arma el selector desde providers', () => {
    const options = mapModelOptions({
      providers: [
        {
          id: 'deepseek',
          label: 'DeepSeek',
          models: [{ id: 'deepseek-v4', label: 'DeepSeek V4 Pro' }],
        },
      ],
    });
    expect(options).toEqual([
      {
        providerId: 'deepseek',
        providerLabel: 'DeepSeek',
        modelId: 'deepseek-v4',
        label: 'DeepSeek V4 Pro',
      },
    ]);
  });

  it('lee skills, toolsets y jobs', () => {
    expect(mapSkills({ data: [{ name: 'github', description: 'PRs', category: 'dev' }] })).toEqual([
      { name: 'github', description: 'PRs', category: 'dev' },
    ]);
    expect(
      mapToolsets({ data: [{ name: 'terminal', label: 'Terminal', description: 'Shell', enabled: true }] }),
    ).toEqual([{ name: 'terminal', label: 'Terminal', description: 'Shell', enabled: true }]);
    expect(
      mapJobs({
        jobs: [
          {
            id: 'a1b2c3d4e5f6',
            name: 'Resumen',
            prompt: 'Novedades',
            schedule: { display: '0 9 * * *' },
            state: 'paused',
            deliver: 'local',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'a1b2c3d4e5f6',
        name: 'Resumen',
        prompt: 'Novedades',
        schedule: '0 9 * * *',
        state: 'paused',
        paused: true,
        deliver: 'local',
      },
    ]);
    expect(mapJob({ job: { id: 'abcdef123456', name: 'Uno', schedule: 'every 2h' } })?.schedule).toBe(
      'every 2h',
    );
    expect(
      mapJob({
        id: 'abcdef123456',
        name: 'Uno',
        schedule: { expr: '30 4 * * *', display: 'every day at 4:30am' },
      })?.schedule,
    ).toBe('30 4 * * *');
  });

  it('marca el día anterior como Ayer', () => {
    const now = new Date(2026, 9, 13, 15, 0, 0).getTime();
    const yesterday = new Date(2026, 9, 12, 18, 30, 0).getTime();
    expect(formatSessionTime(yesterday, now)).toBe('Ayer');
  });
});

describe('cliente Hermes', () => {
  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('acepta el mock cuando /health/detailed no existe', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return json(200, { status: 'ok' });
      if (url.endsWith('/health/detailed')) return json(404, { error: { message: 'missing' } });
      if (url.endsWith('/v1/models')) return json(200, { data: [] });
      return json(500, {});
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'mock-test-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const probe = await client.probe();
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rechaza una clave inválida', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return json(200, { status: 'ok' });
      return json(401, { error: { message: 'Invalid API key' } });
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'no',
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(client.probe()).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('transcribe el stream de un turno', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = jest.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('event: assistant.delta\ndata: {"delta":"Listo"}\n\n: keepalive\n\n'),
          );
          controller.enqueue(
            encoder.encode('event: run.completed\ndata: {"status":"completed"}\n\n'),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642/v1',
      apiKey: 'mock-test-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const events: string[] = [];
    await client.streamChat(
      'sess_1',
      'hola',
      { providerId: 'deepseek', modelId: 'deepseek-v4' },
      (event) => events.push(sseEventName(event)),
    );
    expect(events).toEqual(['assistant.delta', 'run.completed']);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8642/api/sessions/sess_1/chat/stream');
    expect(JSON.parse(String(init.body))).toEqual({
      input: 'hola',
      provider: 'deepseek',
      model: 'deepseek-v4',
    });
  });

  it('informa un stream detenido como cancelación y no como caída de red', async () => {
    const encoder = new TextEncoder();
    const abort = new AbortController();
    const fetchImpl = jest.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: assistant.delta\ndata: {"delta":"Hola"}\n\n'));
        },
        pull(controller) {
          controller.error(new TypeError('Failed to fetch'));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'mock-test-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const pending = client.streamChat('sess_1', 'hola', null, () => abort.abort(), abort.signal);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });

  it('manda una imagen como parte del input', async () => {
    const fetchImpl = jest.fn(async () => json(200, ''));
    const encoder = new TextEncoder();
    fetchImpl.mockImplementation(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: run.completed\ndata: {"status":"completed"}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'mock-test-key',
      fetchImpl: fetchImpl as typeof fetch,
    });
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,aaa' } };
    await client.streamChat('sess_1', [{ type: 'text', text: 'mirá' }, image], null, () => undefined);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).input).toEqual([
      { type: 'text', text: 'mirá' },
      image,
    ]);
  });

  it('fija, ramifica, detiene y aprueba contra el API', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/sessions/sess_1') && init?.method === 'PATCH') {
        return json(200, { session: { id: 'sess_1', title: 'Notas', pinned: true } });
      }
      if (url.endsWith('/fork')) {
        return json(201, { session: { id: 'sess_2', title: 'Notas (copia)' } });
      }
      if (url.endsWith('/model')) return json(200, { runtime: { model: 'deepseek-v4' } });
      if (url.endsWith('/stop')) return json(200, { status: 'stopping' });
      if (url.endsWith('/approval')) return json(200, { choice: 'once' });
      if (url.includes('/messages?')) return json(200, { data: [] });
      if (url.endsWith('/api/model/options?refresh=1')) return json(200, { providers: [] });
      if (url.endsWith('/api/jobs') && init?.method === 'POST') {
        return json(200, { job: { id: 'a1b2c3d4e5f6', name: 'Resumen', schedule: 'every 2h' } });
      }
      return json(500, {});
    });
    const client = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'mock-test-key',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const pinned = await client.patchSession('sess_1', { pinned: true });
    expect(pinned.pinned).toBe(true);
    const copy = await client.forkSession('sess_1', 'Notas (copia)');
    expect(copy.id).toBe('sess_2');
    await client.lockSessionModel('sess_1', { providerId: 'deepseek', modelId: 'deepseek-v4' });
    await client.stopRun('run_1');
    await client.approveRun('run_1', 'once');
    await client.getMessages('sess_1');
    await client.listModelOptions(true);
    const job = await client.createJob({ name: 'Resumen', schedule: 'every 2h', prompt: 'Novedades' });
    expect(job.id).toBe('a1b2c3d4e5f6');

    const bodies = fetchImpl.mock.calls.map((call) => {
      const init = call[1] as RequestInit | undefined;
      return init?.body ? JSON.parse(String(init.body)) : null;
    });
    expect(bodies[4]).toEqual({ choice: 'once' });
    expect(bodies[7]).toEqual({
      name: 'Resumen',
      schedule: 'every 2h',
      prompt: 'Novedades',
      deliver: 'local',
    });
    const messageUrl = String(fetchImpl.mock.calls[5]?.[0]);
    expect(messageUrl).toContain('include_compacted=true');
  });
});
