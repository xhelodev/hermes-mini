import {
  displayUrl,
  formatLastUsed,
  MAX_HISTORY_ENTRIES,
  parseHistory,
  upsertEntry,
  type ConnectionEntry,
} from '@/lib/connection-history';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('@/lib/secret-store', () => ({
  readSecret: jest.fn(),
  writeSecret: jest.fn(),
  deleteSecret: jest.fn(),
}));

function entry(id: string, patch: Partial<ConnectionEntry> = {}): ConnectionEntry {
  return { id, baseUrl: `https://${id}.local`, lastUsedAt: 1, hasKey: false, ...patch };
}

describe('parseHistory', () => {
  it('ordena del más reciente al más viejo', () => {
    const raw = JSON.stringify([entry('a', { lastUsedAt: 1 }), entry('b', { lastUsedAt: 5 })]);
    expect(parseHistory(raw).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('descarta entradas dañadas o con ids que no sirven para SecureStore', () => {
    const raw = JSON.stringify([entry('a'), { id: 'b' }, entry('c/d'), null]);
    expect(parseHistory(raw).map((item) => item.id)).toEqual(['a']);
  });

  it('devuelve vacío sin datos o con JSON roto', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('no es json')).toEqual([]);
    expect(parseHistory('{}')).toEqual([]);
  });
});

describe('upsertEntry', () => {
  it('agrega una URL nueva al principio', () => {
    const { list, dropped } = upsertEntry([entry('a')], {
      baseUrl: 'https://nuevo.local',
      hasKey: true,
      now: 10,
      newId: 'n',
    });
    expect(list.map((item) => item.id)).toEqual(['n', 'a']);
    expect(list[0]).toEqual({ id: 'n', baseUrl: 'https://nuevo.local', lastUsedAt: 10, hasKey: true });
    expect(dropped).toEqual([]);
  });

  it('mueve una URL repetida al principio y conserva su id', () => {
    const { list } = upsertEntry([entry('a'), entry('b')], {
      baseUrl: 'https://b.local',
      hasKey: false,
      now: 10,
      newId: 'n',
    });
    expect(list.map((item) => item.id)).toEqual(['b', 'a']);
    expect(list[0].lastUsedAt).toBe(10);
  });

  it('recorta al máximo y devuelve las que sobran', () => {
    const full = Array.from({ length: MAX_HISTORY_ENTRIES }, (_, i) => entry(`e${i}`));
    const { list, dropped } = upsertEntry(full, {
      baseUrl: 'https://nuevo.local',
      hasKey: false,
      now: 10,
      newId: 'n',
    });
    expect(list).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(list[0].id).toBe('n');
    expect(dropped.map((item) => item.id)).toEqual([`e${MAX_HISTORY_ENTRIES - 1}`]);
  });
});

describe('formato', () => {
  it('saca el protocolo de la URL', () => {
    expect(displayUrl('https://hermes.local:8642/api')).toBe('hermes.local:8642/api');
    expect(displayUrl('http://10.0.0.2')).toBe('10.0.0.2');
  });

  it('describe cuánto pasó desde la última conexión', () => {
    const now = 1_000_000_000;
    expect(formatLastUsed(now - 10_000, now)).toBe('recién');
    expect(formatLastUsed(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(formatLastUsed(now - 3 * 3_600_000, now)).toBe('hace 3 h');
    expect(formatLastUsed(now - 2 * 86_400_000, now)).toBe('hace 2 d');
  });
});
