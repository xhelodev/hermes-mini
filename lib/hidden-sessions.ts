import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import type { HermesSession } from '@/lib/hermes';

// Conversaciones borradas desde este teléfono. Borrar es solo de la app: en Hermes la
// conversación sigue guardada, y acá anotamos, por servidor, cuáles no hay que mostrar.

export const HIDDEN_STORAGE_KEY = '@hermes/hidden-sessions';

type Owner = { baseUrl: string };
type Stored = Record<string, string[]>;

/** Ocultas por servidor; descarta lo que no sean ids. */
export function parseHidden(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored: Stored = {};
    for (const [baseUrl, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(list)) stored[baseUrl] = list.filter((id): id is string => typeof id === 'string' && !!id);
    }
    return stored;
  } catch {
    return {};
  }
}

/** Saca de `sessions` las ocultas; devuelve la misma lista si no había ninguna. */
export function withoutHidden(sessions: HermesSession[], hidden: ReadonlySet<string>): HermesSession[] {
  if (hidden.size === 0 || !sessions.some((session) => hidden.has(session.id))) return sessions;
  return sessions.filter((session) => !hidden.has(session.id));
}

let stored: Stored | null = null;
let loading: Promise<void> | null = null;
const sets = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function emit() {
  sets.clear();
  for (const listener of listeners) listener();
}

function ensureLoaded(): Promise<void> {
  if (stored) return Promise.resolve();
  loading ??= AsyncStorage.getItem(HIDDEN_STORAGE_KEY)
    .catch(() => null)
    .then((raw) => {
      // Si ya se escribió algo mientras se leía, se suma a lo de disco.
      const disk = parseHidden(raw);
      const merged: Stored = { ...disk };
      for (const [baseUrl, ids] of Object.entries(stored ?? {})) {
        merged[baseUrl] = [...new Set([...(disk[baseUrl] ?? []), ...ids])];
      }
      stored = merged;
      emit();
    });
  return loading;
}

async function save(owner: Owner, ids: string[]) {
  stored = { ...stored, [owner.baseUrl]: ids };
  emit();
  await AsyncStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
}

/** Borra de la app: no se vuelven a mostrar, pero siguen en el servidor. */
export async function hideSessions(owner: Owner, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureLoaded();
  const current = stored?.[owner.baseUrl] ?? [];
  const next = [...new Set([...current, ...ids])];
  if (next.length === current.length) return;
  await save(owner, next);
}

/** Vuelve a mostrar todas las borradas de este servidor. Devuelve cuántas eran. */
export async function restoreHiddenSessions(owner: Owner): Promise<number> {
  await ensureLoaded();
  const count = stored?.[owner.baseUrl]?.length ?? 0;
  if (count > 0) await save(owner, []);
  return count;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(baseUrl: string): ReadonlySet<string> | null {
  if (!stored) return null;
  let set = sets.get(baseUrl);
  if (!set) {
    set = new Set(stored[baseUrl] ?? []);
    sets.set(baseUrl, set);
  }
  return set;
}

/** Ids borrados de la app para este servidor; `null` mientras se leen del disco. */
export function useHiddenSessions(owner: Owner): ReadonlySet<string> | null {
  useEffect(() => {
    void ensureLoaded();
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot(owner.baseUrl));
}
