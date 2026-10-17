import type { HermesSession } from '@/lib/hermes';

const mockDisk = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(mockDisk.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      mockDisk.set(key, value);
      return Promise.resolve();
    }),
  },
}));

function session(id: string): HermesSession {
  return {
    id,
    title: `Conversación ${id}`,
    source: null,
    preview: '',
    updatedAt: 1,
    pinned: false,
    archived: false,
    endReason: null,
  };
}

// El módulo guarda el estado en memoria: cada prueba arranca con uno nuevo.
function load() {
  let mod: typeof import('@/lib/hidden-sessions') | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual('@/lib/hidden-sessions');
  });
  return mod!;
}

function stored(baseUrl: string): string[] {
  return load().parseHidden(mockDisk.get('@hermes/hidden-sessions') ?? null)[baseUrl] ?? [];
}

const owner = { baseUrl: 'https://hermes.test' };
const other = { baseUrl: 'https://otro.test' };

beforeEach(() => mockDisk.clear());

describe('parseHidden', () => {
  it('descarta lo que no sean listas de ids', () => {
    const { parseHidden } = load();
    expect(parseHidden(null)).toEqual({});
    expect(parseHidden('{')).toEqual({});
    expect(parseHidden('[]')).toEqual({});
    expect(parseHidden(JSON.stringify({ a: ['x', 3, '', 'y'], b: 'z' }))).toEqual({ a: ['x', 'y'] });
  });
});

describe('withoutHidden', () => {
  it('saca las ocultas y devuelve la misma lista si no hay ninguna', () => {
    const { withoutHidden } = load();
    const list = [session('a'), session('b'), session('c')];
    expect(withoutHidden(list, new Set(['b'])).map((item) => item.id)).toEqual(['a', 'c']);
    expect(withoutHidden(list, new Set(['z']))).toBe(list);
    expect(withoutHidden(list, new Set())).toBe(list);
  });
});

describe('hideSessions', () => {
  it('anota los ids por servidor sin repetir', async () => {
    const { hideSessions } = load();
    await hideSessions(owner, ['a', 'b']);
    await hideSessions(owner, ['b', 'c']);
    await hideSessions(other, ['x']);
    expect(stored(owner.baseUrl)).toEqual(['a', 'b', 'c']);
    expect(stored(other.baseUrl)).toEqual(['x']);
  });

  it('suma a lo que ya estaba en disco', async () => {
    mockDisk.set('@hermes/hidden-sessions', JSON.stringify({ [owner.baseUrl]: ['viejo'] }));
    await load().hideSessions(owner, ['nuevo']);
    expect(stored(owner.baseUrl)).toEqual(['viejo', 'nuevo']);
  });
});

describe('restoreHiddenSessions', () => {
  it('vacía solo las de ese servidor y dice cuántas eran', async () => {
    const { hideSessions, restoreHiddenSessions } = load();
    await hideSessions(owner, ['a', 'b']);
    await hideSessions(other, ['x']);
    expect(await restoreHiddenSessions(owner)).toBe(2);
    expect(stored(owner.baseUrl)).toEqual([]);
    expect(stored(other.baseUrl)).toEqual(['x']);
    expect(await restoreHiddenSessions(owner)).toBe(0);
  });
});
