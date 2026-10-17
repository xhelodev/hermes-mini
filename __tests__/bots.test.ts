import {
  botBaseUrl,
  loadBotKeys,
  loadBots,
  normalizeBotName,
  routineName,
  saveBotKey,
  saveBots,
  stripRoutinePrefix,
} from '@/lib/bots';
import { HermesClient } from '@/lib/hermes/client';

// Almacenamiento en memoria para AsyncStorage y SecureStore.
const mockMemory = new Map<string, string>();
const mockSecrets = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockMemory.set(key, value);
    }),
  },
}));
jest.mock('@/lib/secret-store', () => ({
  readSecret: jest.fn(async (key: string) => mockSecrets.get(key) ?? null),
  writeSecret: jest.fn(async (key: string, value: string) => {
    mockSecrets.set(key, value);
  }),
  deleteSecret: jest.fn(async (key: string) => {
    mockSecrets.delete(key);
  }),
}));

beforeEach(() => {
  mockMemory.clear();
  mockSecrets.clear();
});

describe('nombres de Bots', () => {
  it('acepta nombres de perfil de Hermes, en minúsculas', () => {
    expect(normalizeBotName('  Researcher ')).toBe('researcher');
    expect(normalizeBotName('default')).toBe('default');
    expect(normalizeBotName('mi-bot_2')).toBe('mi-bot_2');
    expect(normalizeBotName('-malo')).toBeNull();
    expect(normalizeBotName('con espacio')).toBeNull();
    expect(normalizeBotName('')).toBeNull();
  });

  it('apunta al perfil bajo /p/', () => {
    expect(botBaseUrl('https://hermes.tail.ts.net/v1/', 'researcher')).toBe('https://hermes.tail.ts.net/p/researcher');
  });

  it('nombra las rutinas como la app de escritorio', () => {
    expect(routineName('researcher', 'Resumen diario')).toBe('[bot:researcher] Resumen diario');
    expect(routineName('researcher', '[bot:researcher] Resumen diario')).toBe('[bot:researcher] Resumen diario');
    expect(stripRoutinePrefix('researcher', '[bot:researcher] Resumen diario')).toBe('Resumen diario');
    expect(stripRoutinePrefix('researcher', 'Otra tarea')).toBe('Otra tarea');
  });
});

describe('Bots guardados', () => {
  it('guarda la lista por servidor', async () => {
    await saveBots('https://a', ['researcher', 'writer']);
    await saveBots('https://b', ['otro']);
    expect(await loadBots('https://a')).toEqual(['researcher', 'writer']);
    expect(await loadBots('https://b')).toEqual(['otro']);
    await saveBots('https://b', []);
    expect(await loadBots('https://b')).toEqual([]);
  });

  it('guarda solo las claves propias, cifradas, y las borra al quitarlas', async () => {
    await saveBotKey('https://a', 'privado', 'clave-propia');
    expect(await loadBotKeys('https://a')).toEqual({ privado: 'clave-propia' });
    expect(mockMemory.size).toBe(0);
    await saveBotKey('https://a', 'privado', null);
    expect(await loadBotKeys('https://a')).toEqual({});
    expect(mockSecrets.size).toBe(0);
  });
});

describe('chat permanente de un Bot', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const client = (fetchImpl: jest.Mock) =>
    new HermesClient({
      baseUrl: 'http://127.0.0.1:8642/p/researcher',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

  it('busca el "Bot Chat" por título exacto, incluidos los ocultos', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) =>
      json(200, { data: [{ id: 'other', title: 'Bot Chat viejo' }, { id: 'bc', title: 'Bot Chat' }] }),
    );
    const chat = await client(fetchImpl).openBotChat();
    expect(chat.id).toBe('bc');
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/p/researcher/api/sessions');
    expect(url.searchParams.get('title')).toBe('Bot Chat');
    expect(url.searchParams.get('include_hidden')).toBe('1');
  });

  it('lo crea si no existe', async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(201, { session: { id: 'nuevo', title: 'Bot Chat' } });
      return json(200, { data: [] });
    });
    const chat = await client(fetchImpl).openBotChat();
    expect(chat.id).toBe('nuevo');
    const post = fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: 'Bot Chat' });
  });

  it('si otro lo creó a la vez, usa ese; si está oculto en un Hermes viejo, lo explica', async () => {
    let lists = 0;
    const raced = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(400, { error: { message: 'Title already in use' } });
      lists += 1;
      return json(200, { data: lists === 1 ? [] : [{ id: 'bc', title: 'Bot Chat' }] });
    });
    await expect(client(raced).openBotChat()).resolves.toMatchObject({ id: 'bc' });

    const hidden = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(400, { error: { message: 'Title already in use' } });
      return json(200, { data: [] });
    });
    await expect(client(hidden).openBotChat()).rejects.toMatchObject({ code: 'conflict' });
  });

  it('prueba el acceso con una conversación', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) => json(401, { error: { message: 'Invalid' } }));
    await expect(client(fetchImpl).checkAccess()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8642/p/researcher/api/sessions?limit=1');
  });
});
