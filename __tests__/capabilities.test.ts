import { HermesClient } from '@/lib/hermes/client';
import { capabilityFlag, mapCapabilities, missingCoreEndpoints } from '@/lib/hermes/map';

const SERVER = {
  object: 'hermes.api_server.capabilities',
  model: 'trabajo',
  features: {
    run_steer: true,
    session_model_lock: false,
    runs_idempotency: { supported: true, durable: true },
    browser_extension_control: { enabled: false, protocol_version: 1 },
    session_key_header: 'X-Hermes-Session-Key',
  },
  endpoints: {
    sessions: { method: 'GET', path: '/api/sessions' },
    session_messages: { method: 'GET', path: '/api/sessions/{session_id}/messages' },
    session_chat_stream: { method: 'POST', path: '/api/sessions/{session_id}/chat/stream' },
  },
};

describe('capacidades del servidor', () => {
  it('lee banderas, objetos con supported/enabled y la tabla de rutas', () => {
    const caps = mapCapabilities(SERVER);
    expect(caps?.model).toBe('trabajo');
    expect(caps?.features).toEqual({
      run_steer: true,
      session_model_lock: false,
      runs_idempotency: true,
      browser_extension_control: false,
    });
    expect(caps?.endpoints).toEqual(['sessions', 'session_messages', 'session_chat_stream']);
    expect(mapCapabilities({ object: 'x' })).toBeNull();
  });

  it('asume que sí cuando no hay datos o falta la bandera', () => {
    const caps = mapCapabilities(SERVER);
    expect(capabilityFlag(caps, 'run_steer')).toBe(true);
    expect(capabilityFlag(caps, 'session_model_lock')).toBe(false);
    expect(capabilityFlag(caps, 'algo_nuevo')).toBe(true);
    expect(capabilityFlag(null, 'session_model_lock')).toBe(true);
  });

  it('detecta un servidor sin el API de conversaciones', () => {
    expect(missingCoreEndpoints(mapCapabilities(SERVER))).toEqual([]);
    expect(missingCoreEndpoints(mapCapabilities({ ...SERVER, endpoints: { health: {} } }))).toEqual([
      'sessions',
      'session_messages',
      'session_chat_stream',
    ]);
    expect(missingCoreEndpoints(mapCapabilities({ ...SERVER, endpoints: {} }))).toEqual([]);
    expect(missingCoreEndpoints(null)).toEqual([]);
  });

  it('devuelve null si el servidor no tiene /v1/capabilities', async () => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const old = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'k',
      fetchImpl: (async () => json(404, { error: { message: 'Not Found' } })) as typeof fetch,
    });
    await expect(old.getCapabilities()).resolves.toBeNull();
    const current = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'k',
      fetchImpl: (async () => json(200, SERVER)) as typeof fetch,
    });
    await expect(current.getCapabilities()).resolves.toMatchObject({ model: 'trabajo' });
    const down = new HermesClient({
      baseUrl: 'http://127.0.0.1:8642',
      apiKey: 'k',
      fetchImpl: (async () => json(503, {})) as typeof fetch,
    });
    await expect(down.getCapabilities()).rejects.toMatchObject({ code: 'down' });
  });
});
