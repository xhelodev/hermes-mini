import type { HermesSession } from '@/lib/hermes';

/** Antigüedades que se ofrecen para borrar en lote (solo de la app), en días. */
export const CLEANUP_AGES = [7, 30, 90, 365] as const;
export type CleanupAge = (typeof CLEANUP_AGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Conversaciones sin actividad desde hace `days` días. Deja afuera las fijadas, las que no
 * tienen fecha (no sabemos su edad) y las de `skip` (por ejemplo, con una respuesta en curso).
 */
export function staleSessions(
  sessions: readonly HermesSession[],
  days: number,
  now: number,
  skip: ReadonlySet<string> = new Set(),
): HermesSession[] {
  const limit = now - days * DAY_MS;
  return sessions.filter(
    (session) =>
      !session.pinned && !skip.has(session.id) && session.updatedAt != null && session.updatedAt <= limit,
  );
}
