import { HermesError, type HermesSession } from '@/lib/hermes';

/** Antigüedades que se ofrecen para borrar en lote, en días. */
export const CLEANUP_AGES = [7, 30, 90, 365] as const;
export type CleanupAge = (typeof CLEANUP_AGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Vueltas máximas de "borrar todas": `listSessions` trae a lo sumo 200 por llamada. */
const MAX_ROUNDS = 20;

type SessionDeleter = { deleteSession: (sessionId: string) => Promise<void> };
type SessionSource = SessionDeleter & { listSessions: () => Promise<HermesSession[]> };

export type CleanupResult = { deleted: string[]; failed: number };

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

/** Borra de a pocas a la vez. Una que ya no existe (404) cuenta como borrada. */
export async function deleteSessions(
  client: SessionDeleter,
  ids: readonly string[],
  concurrency = 3,
): Promise<CleanupResult> {
  const deleted: string[] = [];
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < ids.length) {
      const id = ids[next];
      next += 1;
      try {
        await client.deleteSession(id);
        deleted.push(id);
      } catch (error) {
        if (error instanceof HermesError && error.code === 'not_found') deleted.push(id);
        else failed += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { deleted, failed };
}

/** Borra todas las conversaciones del servidor, salvo las de `skip`, pidiendo la lista por tandas. */
export async function deleteAllSessions(
  client: SessionSource,
  skip: ReadonlySet<string> = new Set(),
): Promise<CleanupResult> {
  const deleted: string[] = [];
  let failed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const targets = (await client.listSessions()).filter(
      (session) => !skip.has(session.id) && !deleted.includes(session.id),
    );
    if (targets.length === 0) break;
    const result = await deleteSessions(
      client,
      targets.map((session) => session.id),
    );
    deleted.push(...result.deleted);
    failed = result.failed;
    // Si en una vuelta no se pudo borrar ninguna, otra vuelta tampoco va a poder.
    if (result.deleted.length === 0) break;
  }
  return { deleted, failed };
}
