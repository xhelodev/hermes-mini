// Caché en memoria de conversaciones ya abiertas, para pintar los mensajes al instante
// mientras se piden de nuevo al servidor. Cada conexión (instancia del cliente) tiene su
// propio espacio: al cambiar de servidor o de clave la caché anterior queda inalcanzable.

export const CHAT_CACHE_LIMIT = 12;

export type SessionCache<T> = {
  get: (owner: object, sessionId: string) => T | undefined;
  set: (owner: object, sessionId: string, value: T) => void;
};

export function createSessionCache<T>(limit = CHAT_CACHE_LIMIT): SessionCache<T> {
  const byOwner = new WeakMap<object, Map<string, T>>();

  function entries(owner: object): Map<string, T> {
    let map = byOwner.get(owner);
    if (!map) {
      map = new Map();
      byOwner.set(owner, map);
    }
    return map;
  }

  return {
    get(owner, sessionId) {
      const map = byOwner.get(owner);
      const value = map?.get(sessionId);
      if (!map || value === undefined) return undefined;
      // El Map conserva el orden de inserción: reinsertar marca la entrada como reciente.
      map.delete(sessionId);
      map.set(sessionId, value);
      return value;
    },
    set(owner, sessionId, value) {
      const map = entries(owner);
      map.delete(sessionId);
      map.set(sessionId, value);
      while (map.size > limit) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
  };
}
