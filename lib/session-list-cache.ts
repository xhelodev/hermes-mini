import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HermesSession } from '@/lib/hermes';

// Última lista de conversaciones vista. En memoria por conexión (instancia del cliente),
// para pintarla al instante aunque la pantalla se haya desmontado, y en disco por servidor
// para el arranque en frío. Siempre se refresca contra el servidor después.

export const SESSION_LIST_STORAGE_KEY = '@hermes/session-list';

type Owner = { baseUrl: string };
type StoredList = { baseUrl: string; sessions: HermesSession[] };

const memory = new WeakMap<object, HermesSession[]>();

export function isSession(value: unknown): value is HermesSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.preview === 'string' &&
    (item.source === null || typeof item.source === 'string') &&
    (item.updatedAt === null || typeof item.updatedAt === 'number') &&
    typeof item.pinned === 'boolean' &&
    typeof item.archived === 'boolean' &&
    (item.endReason === null || typeof item.endReason === 'string')
  );
}

/** Lista guardada para este servidor, o `null` si no hay, es de otro servidor o está dañada. */
export function parseStoredSessions(raw: string | null, baseUrl: string): HermesSession[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const stored = parsed as Partial<StoredList>;
    if (stored.baseUrl !== baseUrl || !Array.isArray(stored.sessions)) return null;
    return stored.sessions.every(isSession) ? stored.sessions : null;
  } catch {
    return null;
  }
}

function sameSession(a: HermesSession, b: HermesSession): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.source === b.source &&
    a.preview === b.preview &&
    a.updatedAt === b.updatedAt &&
    a.pinned === b.pinned &&
    a.archived === b.archived &&
    a.endReason === b.endReason
  );
}

/**
 * Reusa los objetos que no cambiaron para que las filas memoizadas no se vuelvan a pintar.
 * Devuelve la lista anterior tal cual si nada cambió.
 */
export function keepUnchanged(previous: HermesSession[] | null, next: HermesSession[]): HermesSession[] {
  if (!previous) return next;
  const byId = new Map(previous.map((session) => [session.id, session]));
  const merged = next.map((session) => {
    const old = byId.get(session.id);
    return old && sameSession(old, session) ? old : session;
  });
  const same = merged.length === previous.length && merged.every((session, index) => session === previous[index]);
  return same ? previous : merged;
}

export function cachedSessions(owner: Owner): HermesSession[] | undefined {
  return memory.get(owner);
}

export function rememberSessions(owner: Owner, sessions: HermesSession[]) {
  memory.set(owner, sessions);
  const stored: StoredList = { baseUrl: owner.baseUrl, sessions };
  AsyncStorage.setItem(SESSION_LIST_STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
}

export async function loadStoredSessions(owner: Owner): Promise<HermesSession[] | null> {
  try {
    return parseStoredSessions(await AsyncStorage.getItem(SESSION_LIST_STORAGE_KEY), owner.baseUrl);
  } catch {
    return null;
  }
}
