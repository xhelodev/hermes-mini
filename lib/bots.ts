import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeBaseUrl } from '@/lib/hermes/url';
import { deleteSecret, readSecret, writeSecret } from '@/lib/secret-store';

/**
 * En Hermes un Bot es un perfil. El API server atiende cada perfil bajo `/p/<perfil>/`, con
 * su propio `API_SERVER_KEY` (por lo general el mismo del principal, porque al crear un Bot
 * se copian las claves).
 */

export { BOT_CHAT_TITLE } from '@/lib/hermes/map';

/** Como `PROFILE_ID_RE` de Hermes. */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** El nombre del perfil tal como lo guarda Hermes (en minúsculas), o `null` si no es válido. */
export function normalizeBotName(input: string): string | null {
  const name = input.trim().toLowerCase();
  return PROFILE_ID.test(name) ? name : null;
}

export function botBaseUrl(baseUrl: string, bot: string): string {
  return `${normalizeBaseUrl(baseUrl)}/p/${encodeURIComponent(bot)}`;
}

/** La app de escritorio nombra las rutinas de un Bot `[bot:<nombre>] <rutina>`. */
function routinePrefix(bot: string): string {
  return `[bot:${bot}]`;
}

export function stripRoutinePrefix(bot: string, name: string): string {
  const prefix = routinePrefix(bot);
  return name.startsWith(prefix) ? name.slice(prefix.length).trim() : name;
}

export function routineName(bot: string, name: string): string {
  return `${routinePrefix(bot)} ${stripRoutinePrefix(bot, name).trim()}`;
}

const LIST_KEY = '@hermes/bots';
// SecureStore guarda texto por clave: todas las claves de Bots van juntas, por servidor.
const KEYS_KEY = 'hermes_bot_keys';

type PerServer<T> = Record<string, T>;

function parse<T>(raw: string | null): PerServer<T> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as PerServer<T>) : {};
  } catch {
    return {};
  }
}

export async function loadBots(baseUrl: string): Promise<string[]> {
  const list = parse<unknown>(await AsyncStorage.getItem(LIST_KEY))[baseUrl];
  if (!Array.isArray(list)) return [];
  return list.filter((name): name is string => typeof name === 'string' && normalizeBotName(name) === name);
}

export async function saveBots(baseUrl: string, bots: string[]): Promise<void> {
  const all = parse<string[]>(await AsyncStorage.getItem(LIST_KEY));
  if (bots.length > 0) all[baseUrl] = bots;
  else delete all[baseUrl];
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(all));
}

/** Solo las claves propias de algunos Bots; el resto usa la del servidor. */
export async function loadBotKeys(baseUrl: string): Promise<Record<string, string>> {
  const keys = parse<Record<string, string>>(await readSecret(KEYS_KEY))[baseUrl];
  return keys && typeof keys === 'object' ? keys : {};
}

export async function saveBotKey(baseUrl: string, bot: string, key: string | null): Promise<void> {
  const all = parse<Record<string, string>>(await readSecret(KEYS_KEY));
  const keys = { ...all[baseUrl] };
  if (key) keys[bot] = key;
  else delete keys[bot];
  if (Object.keys(keys).length > 0) all[baseUrl] = keys;
  else delete all[baseUrl];
  if (Object.keys(all).length === 0) await deleteSecret(KEYS_KEY);
  else await writeSecret(KEYS_KEY, JSON.stringify(all));
}
