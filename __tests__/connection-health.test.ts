import type { HermesClient } from '@/lib/hermes';
import { HermesError } from '@/lib/hermes/errors';
import {
  checkConnection,
  getConnectionHealth,
  resetConnectionHealth,
  setHealthClient,
} from '@/lib/connection-health';

jest.mock('react-native', () => ({ AppState: { addEventListener: jest.fn() } }), { virtual: true });

function fakeClient(...results: ('ok' | 'fail')[]): HermesClient {
  const probe = jest.fn(async () => {
    const next = results.shift() ?? 'ok';
    if (next === 'fail') throw new HermesError('down', 'caído');
    return { latencyMs: 42 };
  });
  return { probe } as unknown as HermesClient;
}

describe('estado de la conexión con Hermes', () => {
  beforeEach(() => resetConnectionHealth());

  it('arranca verificando y pasa a conectado', async () => {
    setHealthClient(fakeClient('ok'));
    expect(getConnectionHealth().status).toBe('checking');
    await checkConnection();
    expect(getConnectionHealth()).toMatchObject({ status: 'online', latencyMs: 42, error: null });
  });

  it('marca sin conexión cuando el sondeo falla de entrada', async () => {
    setHealthClient(fakeClient('fail'));
    await checkConnection();
    expect(getConnectionHealth()).toMatchObject({
      status: 'offline',
      error: 'No se pudo conectar con el servidor.',
    });
  });

  it('reintenta una vez antes de pasar de verde a rojo', async () => {
    const client = fakeClient('ok', 'fail', 'ok');
    setHealthClient(client);
    await checkConnection();
    await checkConnection();
    expect(getConnectionHealth().status).toBe('online');
    expect(client.probe).toHaveBeenCalledTimes(3);
  });

  it('pasa a rojo si el reintento también falla', async () => {
    setHealthClient(fakeClient('ok', 'fail', 'fail'));
    await checkConnection();
    await checkConnection();
    expect(getConnectionHealth().status).toBe('offline');
  });

  it('al tocar el indicador muestra amarillo mientras verifica', async () => {
    setHealthClient(fakeClient('ok', 'ok'));
    await checkConnection();
    const pending = checkConnection(true);
    expect(getConnectionHealth().status).toBe('checking');
    await pending;
    expect(getConnectionHealth().status).toBe('online');
  });
});
