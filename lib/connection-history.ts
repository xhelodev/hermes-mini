import AsyncStorage from '@react-native-async-storage/async-storage';

import { deleteSecret, readSecret, writeSecret } from '@/lib/secret-store';

// Servidores a los que ya se conectó este teléfono. La lista (URL y fecha) va en
// AsyncStorage; la clave de cada uno, solo si se pidió recordarla, va cifrada aparte.
// Cerrar sesión no la borra: se limpia desde la pantalla de conexión.

export const CONNECTION_HISTORY_KEY = '@hermes/connection-history';
export const MAX_HISTORY_ENTRIES = 8;

export type ConnectionEntry = {
  /** Alfanumérico: también nombra la clave en SecureStore. */
  id: string;
  baseUrl: string;
  lastUsedAt: number;
  hasKey: boolean;
};

function isEntry(value: unknown): value is ConnectionEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    /^[a-z0-9]+$/i.test(item.id) &&
    typeof item.baseUrl === 'string' &&
    typeof item.lastUsedAt === 'number' &&
    typeof item.hasKey === 'boolean'
  );
}

/** Historial guardado, del más reciente al más viejo. Descarta lo que esté dañado. */
export function parseHistory(raw: string | null): ConnectionEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isEntry)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Pone `baseUrl` primero (reusando su id si ya estaba) y recorta al máximo.
 * Devuelve también las entradas que quedaron afuera, para borrar sus claves.
 */
export function upsertEntry(
  list: ConnectionEntry[],
  next: { baseUrl: string; hasKey: boolean; now: number; newId: string },
): { list: ConnectionEntry[]; dropped: ConnectionEntry[] } {
  const existing = list.find((entry) => entry.baseUrl === next.baseUrl);
  const entry: ConnectionEntry = {
    id: existing?.id ?? next.newId,
    baseUrl: next.baseUrl,
    lastUsedAt: next.now,
    hasKey: next.hasKey,
  };
  const merged = [entry, ...list.filter((item) => item.baseUrl !== next.baseUrl)];
  return { list: merged.slice(0, MAX_HISTORY_ENTRIES), dropped: merged.slice(MAX_HISTORY_ENTRIES) };
}

/** URL sin protocolo, para mostrar. */
export function displayUrl(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//i, '');
}

/** "recién", "hace 5 min", "hace 3 h", "hace 2 d" o la fecha. */
export function formatLastUsed(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(timestamp).toLocaleDateString();
}

function secretKey(id: string) {
  return `hermes_history_key_${id}`;
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function writeHistory(list: ConnectionEntry[]) {
  await AsyncStorage.setItem(CONNECTION_HISTORY_KEY, JSON.stringify(list));
}

export async function loadHistory(): Promise<ConnectionEntry[]> {
  try {
    return parseHistory(await AsyncStorage.getItem(CONNECTION_HISTORY_KEY));
  } catch {
    return [];
  }
}

/** Registra una conexión que ya respondió. Sin `remember`, se olvida la clave guardada. */
export async function recordConnection(
  baseUrl: string,
  apiKey: string,
  remember: boolean,
): Promise<ConnectionEntry[]> {
  const current = await loadHistory();
  const { list, dropped } = upsertEntry(current, {
    baseUrl,
    hasKey: remember,
    now: Date.now(),
    newId: newId(),
  });
  const id = list[0].id;
  if (remember) await writeSecret(secretKey(id), apiKey.trim());
  else await deleteSecret(secretKey(id));
  await Promise.all(dropped.map((entry) => deleteSecret(secretKey(entry.id))));
  await writeHistory(list);
  return list;
}

export async function readEntryKey(entry: ConnectionEntry): Promise<string | null> {
  if (!entry.hasKey) return null;
  return readSecret(secretKey(entry.id));
}

export async function removeEntry(id: string): Promise<ConnectionEntry[]> {
  const list = (await loadHistory()).filter((entry) => entry.id !== id);
  await deleteSecret(secretKey(id));
  await writeHistory(list);
  return list;
}

export async function clearHistory(): Promise<void> {
  const list = await loadHistory();
  await Promise.all(list.map((entry) => deleteSecret(secretKey(entry.id))));
  await AsyncStorage.removeItem(CONNECTION_HISTORY_KEY);
}
