import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { HermesError, type HermesSession } from '@/lib/hermes';
import { isSession } from '@/lib/session-list-cache';

// Conversaciones archivadas desde este teléfono. El archivado vive en el servidor
// (`archived: true`), pero `GET /api/sessions` no las devuelve ni permite pedirlas: por eso
// guardamos acá cuáles son, por servidor, para poder mostrar la carpeta.

export const ARCHIVED_STORAGE_KEY = '@hermes/archived-sessions';

type Owner = { baseUrl: string };
type Stored = Record<string, HermesSession[]>;

/** Archivadas por servidor; descarta lo que no tenga forma de sesión. */
export function parseArchived(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored: Stored = {};
    for (const [baseUrl, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) stored[baseUrl] = list.filter(isSession);
    }
    return stored;
  } catch {
    return {};
  }
}

/** Más reciente primero, como la lista principal. */
function sorted(list: HermesSession[]): HermesSession[] {
  return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Agrega o reemplaza `sessions` (marcadas como archivadas). */
export function withArchived(list: readonly HermesSession[], sessions: readonly HermesSession[]): HermesSession[] {
  const ids = new Set(sessions.map((session) => session.id));
  const fresh = sessions.map((session) => ({ ...session, archived: true }));
  return sorted([...list.filter((session) => !ids.has(session.id)), ...fresh]);
}

export function withoutArchived(list: readonly HermesSession[], ids: Iterable<string>): HermesSession[] {
  const gone = new Set(ids);
  return list.filter((session) => !gone.has(session.id));
}

let stored: Stored | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function ensureLoaded(): Promise<void> {
  if (stored) return Promise.resolve();
  loading ??= AsyncStorage.getItem(ARCHIVED_STORAGE_KEY)
    .catch(() => null)
    .then((raw) => {
      // Si ya se escribió algo mientras se leía, eso manda sobre lo de disco.
      stored = { ...parseArchived(raw), ...(stored ?? {}) };
      emit();
    });
  return loading;
}

async function change(owner: Owner, update: (list: HermesSession[]) => HermesSession[]) {
  await ensureLoaded();
  const current = stored?.[owner.baseUrl] ?? [];
  const next = update(current);
  if (next.length === current.length && next.every((session, index) => session === current[index])) return;
  stored = { ...stored, [owner.baseUrl]: next };
  emit();
  await AsyncStorage.setItem(ARCHIVED_STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
}

export function rememberArchived(owner: Owner, sessions: readonly HermesSession[]): Promise<void> {
  if (sessions.length === 0) return Promise.resolve();
  return change(owner, (list) => withArchived(list, sessions));
}

export function forgetArchived(owner: Owner, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return change(owner, (list) => {
    const next = withoutArchived(list, ids);
    return next.length === list.length ? list : next;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Archivadas de este servidor; `null` mientras se leen del disco. */
export function useArchivedSessions(owner: Owner): HermesSession[] | null {
  useEffect(() => {
    void ensureLoaded();
  }, []);
  return useSyncExternalStore(subscribe, () => (stored ? (stored[owner.baseUrl] ?? EMPTY) : null));
}

const EMPTY: HermesSession[] = [];

type ArchiveClient = Owner & {
  patchSession: (sessionId: string, patch: { archived: boolean }) => Promise<HermesSession>;
};

/** Archiva en el servidor y la anota acá para poder listarla. */
export async function archiveSession(client: ArchiveClient, session: HermesSession): Promise<void> {
  const next = await client.patchSession(session.id, { archived: true });
  await rememberArchived(client, [next]);
}

/** Desarchiva en el servidor; si ya no existe, igual la saca de la carpeta. */
export async function unarchiveSession(client: ArchiveClient, session: HermesSession): Promise<HermesSession | null> {
  try {
    const next = await client.patchSession(session.id, { archived: false });
    await forgetArchived(client, [session.id]);
    return next;
  } catch (error) {
    if (error instanceof HermesError && error.code === 'not_found') {
      await forgetArchived(client, [session.id]);
      return null;
    }
    throw error;
  }
}

type RefreshClient = ArchiveClient & { getSession: (sessionId: string) => Promise<HermesSession> };

/**
 * Vuelve a pedir cada archivada al servidor: actualiza título y fecha, y saca de la carpeta
 * las que se borraron o se desarchivaron desde otro lado.
 */
export async function refreshArchived(client: RefreshClient, concurrency = 3): Promise<void> {
  await ensureLoaded();
  const list = stored?.[client.baseUrl] ?? [];
  const fresh: HermesSession[] = [];
  const gone: string[] = [];
  let next = 0;

  async function worker() {
    while (next < list.length) {
      const session = list[next];
      next += 1;
      if (!session) continue;
      try {
        const current = await client.getSession(session.id);
        if (current.archived) fresh.push(current);
        else gone.push(session.id);
      } catch (error) {
        if (error instanceof HermesError && error.code === 'not_found') gone.push(session.id);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  await forgetArchived(client, gone);
  await rememberArchived(client, fresh);
}
