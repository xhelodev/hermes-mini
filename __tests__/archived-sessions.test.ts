import {
  archiveSession,
  parseArchived,
  refreshArchived,
  unarchiveSession,
  withArchived,
  withoutArchived,
} from '@/lib/archived-sessions';
import { HermesError, type HermesSession } from '@/lib/hermes';

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

function session(id: string, patch: Partial<HermesSession> = {}): HermesSession {
  return {
    id,
    title: `Conversación ${id}`,
    source: null,
    preview: '',
    updatedAt: 1,
    pinned: false,
    archived: false,
    endReason: null,
    ...patch,
  };
}

function stored(baseUrl: string): string[] {
  return (parseArchived(mockDisk.get('@hermes/archived-sessions') ?? null)[baseUrl] ?? []).map((item) => item.id);
}

describe('parseArchived', () => {
  it('lee las archivadas por servidor y descarta lo que no es una sesión', () => {
    const raw = JSON.stringify({ 'http://a': [session('x'), { id: 'roto' }], 'http://b': 'nada' });
    expect(parseArchived(raw)).toEqual({ 'http://a': [session('x')] });
  });

  it('devuelve vacío si no hay nada o está dañado', () => {
    expect(parseArchived(null)).toEqual({});
    expect(parseArchived('no es json')).toEqual({});
    expect(parseArchived('[]')).toEqual({});
  });
});

describe('withArchived / withoutArchived', () => {
  it('agrega o reemplaza, marca como archivada y ordena por fecha', () => {
    const list = withArchived([session('a', { updatedAt: 5 })], [session('b', { updatedAt: 9 })]);
    expect(list.map((item) => item.id)).toEqual(['b', 'a']);
    expect(list.find((item) => item.id === 'b')?.archived).toBe(true);
    const renamed = withArchived(list, [session('a', { title: 'Nuevo', updatedAt: 5 })]);
    expect(renamed.map((item) => item.title)).toEqual(['Conversación b', 'Nuevo']);
  });

  it('saca por id', () => {
    expect(withoutArchived([session('a'), session('b')], ['a']).map((item) => item.id)).toEqual(['b']);
  });
});

describe('archivar contra el servidor', () => {
  const baseUrl = 'http://hermes.local';

  it('archiva, desarchiva y refresca la carpeta', async () => {
    const server = new Map<string, HermesSession>([
      ['a', session('a')],
      ['b', session('b')],
      ['c', session('c')],
    ]);
    const client = {
      baseUrl,
      patchSession: jest.fn(async (id: string, patch: { archived?: boolean }) => {
        const current = server.get(id);
        if (!current) throw new HermesError('not_found', 'no existe', 404);
        const next = { ...current, ...patch };
        server.set(id, next);
        return next;
      }),
      getSession: jest.fn(async (id: string) => {
        const current = server.get(id);
        if (!current) throw new HermesError('not_found', 'no existe', 404);
        return current;
      }),
    };

    await archiveSession(client, session('a'));
    await archiveSession(client, session('b'));
    await archiveSession(client, session('c'));
    expect(client.patchSession).toHaveBeenCalledWith('a', { archived: true });
    expect(stored(baseUrl).sort()).toEqual(['a', 'b', 'c']);

    await unarchiveSession(client, session('a', { archived: true }));
    expect(server.get('a')?.archived).toBe(false);
    expect(stored(baseUrl).sort()).toEqual(['b', 'c']);

    // Desde otro lado: `b` se borró y `c` se desarchivó.
    server.delete('b');
    server.set('c', { ...session('c'), archived: false });
    await refreshArchived(client);
    expect(stored(baseUrl)).toEqual([]);
  });

  it('desarchivar una que ya no existe la saca de la carpeta igual', async () => {
    const client = {
      baseUrl: 'http://otro',
      patchSession: jest.fn(async (id: string, patch: { archived?: boolean }) => {
        if (patch.archived === false) throw new HermesError('not_found', 'no existe', 404);
        return session(id, { archived: true });
      }),
    };
    await archiveSession(client, session('z'));
    expect(stored('http://otro')).toEqual(['z']);
    await expect(unarchiveSession(client, session('z'))).resolves.toBeNull();
    expect(stored('http://otro')).toEqual([]);
  });
});
