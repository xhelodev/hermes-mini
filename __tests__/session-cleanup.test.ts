import type { HermesSession } from '@/lib/hermes';
import { staleSessions } from '@/lib/session-cleanup';

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
