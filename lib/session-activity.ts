import { useSyncExternalStore } from 'react';

/**
 * Estado compartido entre el chat y la lista de conversaciones: qué sesiones tienen una
 * respuesta en curso y cuál es su último mensaje. El servidor manda como `preview` el
 * primer mensaje, así que el último lo guardamos acá.
 */

export type LastMessage = { role: string; text: string };

/** Último mensaje con texto del usuario o del asistente (salta herramientas y sistema). */
export function lastMessageOf(messages: readonly { role: string; text: string }[]): LastMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (message.text.trim()) return { role: message.role, text: message.text };
  }
  return null;
}

type LastEntry = {
  message: LastMessage | null;
  /** `updatedAt` de la sesión cuando se leyó del servidor; `null` si vino del chat local. */
  stamp: number | null;
};

type Snapshot = {
  /** Sesión → etiqueta de actividad (`null` = pensando). */
  running: ReadonlyMap<string, string | null>;
  last: ReadonlyMap<string, LastEntry>;
};

let snapshot: Snapshot = { running: new Map(), last: new Map() };
const listeners = new Set<() => void>();

function commit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
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

export function startRun(sessionId: string, userText: string) {
  const running = new Map(snapshot.running);
  running.set(sessionId, null);
  const last = new Map(snapshot.last);
  if (userText.trim()) last.set(sessionId, { message: { role: 'user', text: userText }, stamp: null });
  commit({ running, last });
}

export function setRunActivity(sessionId: string, label: string | null) {
  if (!snapshot.running.has(sessionId) || snapshot.running.get(sessionId) === label) return;
  const running = new Map(snapshot.running);
  running.set(sessionId, label);
  commit({ running });
}

export function finishRun(sessionId: string, reply: string) {
  const running = new Map(snapshot.running);
  running.delete(sessionId);
  if (!reply.trim()) {
    commit({ running });
    return;
  }
  const last = new Map(snapshot.last);
  last.set(sessionId, { message: { role: 'assistant', text: reply }, stamp: null });
  commit({ running, last });
}

export function rememberLastMessage(sessionId: string, message: LastMessage | null, stamp: number | null) {
  const last = new Map(snapshot.last);
  last.set(sessionId, { message, stamp });
  commit({ last });
}

/** Hay que volver a pedirlo si nunca se leyó o si la sesión cambió desde la última lectura. */
export function lastMessageIsStale(sessionId: string, updatedAt: number | null): boolean {
  const entry = snapshot.last.get(sessionId);
  return !entry || entry.stamp !== updatedAt;
}

export function useSessionActivity(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useSessionRunning(sessionId: string): boolean {
  return useSyncExternalStore(subscribe, () => snapshot.running.has(sessionId));
}
