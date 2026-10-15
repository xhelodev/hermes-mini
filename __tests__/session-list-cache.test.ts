import type { HermesSession } from '@/lib/hermes';
import { keepUnchanged, parseStoredSessions } from '@/lib/session-list-cache';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(() => Promise.resolve()) },
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

describe('parseStoredSessions', () => {
  const baseUrl = 'http://hermes.local';

  it('devuelve la lista guardada para el mismo servidor', () => {
    const sessions = [session('a'), session('b', { pinned: true })];
    expect(parseStoredSessions(JSON.stringify({ baseUrl, sessions }), baseUrl)).toEqual(sessions);
  });

  it('ignora la lista de otro servidor', () => {
    const raw = JSON.stringify({ baseUrl: 'http://otro', sessions: [session('a')] });
    expect(parseStoredSessions(raw, baseUrl)).toBeNull();
  });

  it('ignora datos vacíos, dañados o con otra forma', () => {
    expect(parseStoredSessions(null, baseUrl)).toBeNull();
    expect(parseStoredSessions('no es json', baseUrl)).toBeNull();
    expect(parseStoredSessions(JSON.stringify({ baseUrl, sessions: [{ id: 'a' }] }), baseUrl)).toBeNull();
  });
});

describe('keepUnchanged', () => {
  it('sin lista anterior usa la nueva', () => {
    const next = [session('a')];
    expect(keepUnchanged(null, next)).toBe(next);
  });

  it('devuelve la lista anterior si nada cambió', () => {
    const previous = [session('a'), session('b')];
    expect(keepUnchanged(previous, [session('a'), session('b')])).toBe(previous);
  });

  it('reusa las sesiones iguales y toma las que cambiaron', () => {
    const previous = [session('a'), session('b')];
    const merged = keepUnchanged(previous, [session('b', { updatedAt: 2 }), session('a')]);
    expect(merged).not.toBe(previous);
    expect(merged[0]?.updatedAt).toBe(2);
    expect(merged[1]).toBe(previous[0]);
  });
});
