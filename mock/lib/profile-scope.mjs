import { AsyncLocalStorage } from 'node:async_hooks';
import { MOCK_API_KEY } from './constants.mjs';

/**
 * Perfiles del mock, como el gateway multiplexado de Hermes: cada uno se atiende bajo
 * `/p/<perfil>/`, con sus propias conversaciones y su propio API_SERVER_KEY. `privado` tiene
 * otra clave para probar un Bot que no comparte la del servidor. `MOCK_PROFILES`
 * (`nombre` o `nombre:clave`, separados por coma) reemplaza la lista.
 */
function parseProfiles(raw) {
  if (!raw) return { researcher: MOCK_API_KEY, writer: MOCK_API_KEY, privado: 'mock-private-key' };
  return Object.fromEntries(
    raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, key] = entry.split(':');
        return [name.trim().toLowerCase(), (key || MOCK_API_KEY).trim()];
      }),
  );
}

const PROFILES = parseProfiles(process.env.MOCK_PROFILES);
const scope = new AsyncLocalStorage();

/** La clave del perfil, o `null` si el mock no lo atiende (Hermes responde 404). */
export function profileKey(profile) {
  if (profile === 'default') return MOCK_API_KEY;
  return Object.hasOwn(PROFILES, profile) ? PROFILES[profile] : null;
}

/** Corre `fn` con ese perfil; lo que siga después (turnos lentos, runs) lo conserva. */
export function withProfile(profile, fn) {
  return scope.run(profile, fn);
}

export function currentProfile() {
  return scope.getStore() ?? 'default';
}

/** Separa `/p/<perfil>/resto` en perfil y resto; `null` si no hay prefijo. */
export function splitProfile(url) {
  const match = /^\/p\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(url || '');
  if (!match) return null;
  return { profile: decodeURIComponent(match[1]).toLowerCase(), rest: `${match[2] || '/'}${match[3] || ''}` };
}
