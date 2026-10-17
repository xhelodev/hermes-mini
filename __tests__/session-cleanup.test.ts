import { HermesError, type HermesSession } from '@/lib/hermes';
import { deleteAllSessions, deleteSessions, staleSessions } from '@/lib/session-cleanup';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function session(id: string, patch: Partial<HermesSession> = {}): HermesSession {
  return {
    id,
    title: id,
    source: null,
    preview: '',
    updatedAt: NOW,
    pinned: false,
    archived: false,
    endReason: null,
    ...patch,
  };
}

describe('staleSessions', () => {
  const list = [
    session('hoy'),
    session('vieja', { updatedAt: NOW - 10 * DAY }),
    session('justo', { updatedAt: NOW - 7 * DAY }),
    session('fijada', { updatedAt: NOW - 40 * DAY, pinned: true }),
    session('sin-fecha', { updatedAt: null }),
    session('en-curso', { updatedAt: NOW - 40 * DAY }),
  ];

  it('elige las que no tienen actividad hace más de N días', () => {
    const ids = staleSessions(list, 7, NOW, new Set(['en-curso'])).map((item) => item.id);
    expect(ids).toEqual(['vieja', 'justo']);
  });

  it('deja afuera fijadas, sin fecha y las que se pidió saltear', () => {
    expect(staleSessions(list, 30, NOW, new Set(['en-curso']))).toEqual([]);
    expect(staleSessions(list, 30, NOW).map((item) => item.id)).toEqual(['en-curso']);
  });
});

describe('deleteSessions', () => {
  it('cuenta como borrada la que ya no existe y separa los fallos', async () => {
    const client = {
      deleteSession: jest.fn(async (id: string) => {
        if (id === 'b') throw new HermesError('not_found', 'no');
        if (id === 'c') throw new HermesError('down', 'caído');
      }),
    };
    const result = await deleteSessions(client, ['a', 'b', 'c', 'd'], 2);
    expect(result.deleted.sort()).toEqual(['a', 'b', 'd']);
    expect(result.failed).toBe(1);
    expect(client.deleteSession).toHaveBeenCalledTimes(4);
  });

  it('no hace nada con una lista vacía', async () => {
    const client = { deleteSession: jest.fn() };
    expect(await deleteSessions(client, [])).toEqual({ deleted: [], failed: 0 });
    expect(client.deleteSession).not.toHaveBeenCalled();
  });
});

describe('deleteAllSessions', () => {
  it('pide la lista de nuevo hasta vaciarla y respeta las salteadas', async () => {
    let server = Array.from({ length: 5 }, (_, i) => session(`s${i}`));
    const client = {
      // Como el servidor real, devuelve una tanda limitada por llamada.
      listSessions: jest.fn(async () => server.slice(0, 2)),
      deleteSession: jest.fn(async (id: string) => {
        server = server.filter((item) => item.id !== id);
      }),
    };
    server.unshift(session('activa'));
    const result = await deleteAllSessions(client, new Set(['activa']));
    expect(result.deleted.sort()).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(server.map((item) => item.id)).toEqual(['activa']);
  });

  it('corta si una vuelta no pudo borrar nada', async () => {
    const client = {
      listSessions: jest.fn(async () => [session('a')]),
      deleteSession: jest.fn(async () => {
        throw new HermesError('down', 'caído');
      }),
    };
    expect(await deleteAllSessions(client)).toEqual({ deleted: [], failed: 1 });
    expect(client.listSessions).toHaveBeenCalledTimes(1);
  });
});
