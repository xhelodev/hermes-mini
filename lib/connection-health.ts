import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { describeHermesError, HermesError, type HermesClient } from '@/lib/hermes';

/**
 * Estado de la conexión con Hermes compartido entre pantallas: un solo sondeo periódico
 * mientras haya algún indicador montado, aunque se vean varios a la vez.
 */

export type HealthStatus = 'checking' | 'online' | 'offline';

export type HealthSnapshot = {
  status: HealthStatus;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number | null;
};

/** Con la conexión sana se revisa cada tanto; caída, se reintenta más seguido. */
export const ONLINE_INTERVAL_MS = 30_000;
export const OFFLINE_INTERVAL_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;

const initial: HealthSnapshot = { status: 'checking', latencyMs: null, error: null, checkedAt: null };

let snapshot: HealthSnapshot = initial;
let currentClient: HermesClient | null = null;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let watchers = 0;
const listeners = new Set<() => void>();

function commit(next: Partial<HealthSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (watchers === 0 || !currentClient) return;
  const delay = snapshot.status === 'online' ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS;
  timer = setTimeout(() => {
    void checkConnection();
  }, delay);
}

async function probeOnce(client: HermesClient): Promise<{ latencyMs: number }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.probe(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new HermesError('timeout', 'El servidor no respondió a tiempo.')),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Sondea al servidor. `visible` pinta el amarillo mientras se verifica (al tocar el punto);
 * en segundo plano se mantiene el color hasta tener resultado. Si estaba en verde y falla,
 * pasa a amarillo y reintenta una vez antes de marcarlo rojo, para no alarmar por un corte puntual.
 */
export function checkConnection(visible = false): Promise<void> {
  const client = currentClient;
  if (!client) return Promise.resolve();
  if (inFlight) {
    if (visible) commit({ status: 'checking' });
    return inFlight;
  }
  if (visible || snapshot.checkedAt === null) commit({ status: 'checking' });

  const run = (async () => {
    const wasOnline = snapshot.status === 'online';
    try {
      let result: { latencyMs: number };
      try {
        result = await probeOnce(client);
      } catch (error) {
        if (!wasOnline) throw error;
        if (client === currentClient) commit({ status: 'checking' });
        result = await probeOnce(client);
      }
      if (client !== currentClient) return;
      commit({ status: 'online', latencyMs: result.latencyMs, error: null, checkedAt: Date.now() });
    } catch (error) {
      if (client !== currentClient) return;
      commit({
        status: 'offline',
        latencyMs: null,
        error: describeHermesError(error),
        checkedAt: Date.now(),
      });
    } finally {
      inFlight = null;
      schedule();
    }
  })();
  inFlight = run;
  return run;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

/** Mantiene vivo el sondeo mientras el componente esté montado y devuelve el estado actual. */
export function useConnectionHealth(client: HermesClient | null): HealthSnapshot {
  useEffect(() => {
    if (client !== currentClient) {
      currentClient = client;
      inFlight = null;
      commit(initial);
    }
    watchers += 1;
    const stale =
      snapshot.checkedAt === null || Date.now() - snapshot.checkedAt > OFFLINE_INTERVAL_MS;
    if (stale) void checkConnection();
    else schedule();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkConnection();
    });
    return () => {
      sub.remove();
      watchers -= 1;
      if (watchers === 0 && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, [client]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Solo para tests. */
export function resetConnectionHealth() {
  if (timer) clearTimeout(timer);
  timer = null;
  snapshot = initial;
  currentClient = null;
  inFlight = null;
  watchers = 0;
}

/** Solo para tests: fija el cliente sin montar el hook. */
export function setHealthClient(client: HermesClient | null) {
  currentClient = client;
}

export function getConnectionHealth() {
  return snapshot;
}
