import { IDEMPOTENCY_TTL_MS, MAX_CONCURRENT_RUNS } from './constants.mjs';
import { randomUUID } from 'node:crypto';
import { currentProfile } from './profile-scope.mjs';

function getState() {
  if (!globalThis.__hermesMockState) {
    globalThis.__hermesMockState = {
      // Conversaciones por perfil (`/p/<perfil>/`), como el gateway multiplexado.
      sessionsByProfile: new Map(),
      runs: new Map(),
      idempotency: new Map(),
      activeRuns: 0,
      modelOptionsOverride: null,
    };
  }
  return globalThis.__hermesMockState;
}

export function setModelOptionsOverride(options) {
  getState().modelOptionsOverride = options;
}

export function getModelOptionsOverride() {
  return getState().modelOptionsOverride;
}

function sessions() {
  const byProfile = getState().sessionsByProfile;
  const profile = currentProfile();
  if (!byProfile.has(profile)) byProfile.set(profile, new Map());
  return byProfile.get(profile);
}

export function listSessions() {
  return [...sessions().values()];
}

export function createSession(meta = {}) {
  const id = `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const session = {
    id,
    object: 'hermes.session',
    title: meta.title || 'New session',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    end_reason: null,
    pinned: false,
    archived: false,
    messages: [],
  };
  sessions().set(id, session);
  return session;
}

export function getSession(id) {
  return sessions().get(id) || null;
}

export function updateSession(id, patch) {
  const s = getSession(id);
  if (!s) return null;
  if (patch.title !== undefined) s.title = patch.title;
  if (patch.end_reason !== undefined) s.end_reason = patch.end_reason;
  if (typeof patch.pinned === 'boolean') s.pinned = patch.pinned;
  if (typeof patch.archived === 'boolean') s.archived = patch.archived;
  s.updated_at = new Date().toISOString();
  return s;
}

export function deleteSession(id) {
  return sessions().delete(id);
}

export function appendMessage(sessionId, message) {
  const s = getSession(sessionId);
  if (!s) return null;
  const msg = { id: `msg_${randomUUID().slice(0, 8)}`, ...message };
  s.messages.push(msg);
  s.updated_at = new Date().toISOString();
  return msg;
}

export function tryAcquireRunSlot() {
  const st = getState();
  if (st.activeRuns >= MAX_CONCURRENT_RUNS) return false;
  st.activeRuns += 1;
  return true;
}

export function releaseRunSlot() {
  const st = getState();
  st.activeRuns = Math.max(0, st.activeRuns - 1);
}

export function createRun(body, idempotencyKey) {
  const st = getState();
  if (idempotencyKey) {
    const existing = st.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== hashBody(body)) {
        return { conflict: true };
      }
      return { replay: true, run: st.runs.get(existing.runId) };
    }
  }
  const runId = `run_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const run = {
    object: 'hermes.run',
    run_id: runId,
    status: 'started',
    session_id: body.session_id || null,
    model: body.model || 'hermes-agent',
    input: body.input || '',
    output: null,
    created_at: Date.now(),
    // Transporte de /events, como el _RunStream de Hermes: eventos numerados para retomar con
    // Last-Event-ID y avisos a quien esté conectado.
    events: [],
    nextSeq: 0,
    terminal: false,
    subscribers: new Set(),
    steers: [],
  };
  st.runs.set(runId, run);
  if (idempotencyKey) {
    st.idempotency.set(idempotencyKey, {
      runId,
      bodyHash: hashBody(body),
      at: Date.now(),
    });
  }
  pruneIdempotency();
  return { run };
}

export function getRun(runId) {
  return getState().runs.get(runId) || null;
}

/** Agrega un evento al transporte del turno; `null` lo cierra. */
export function pushRunEvent(runId, event) {
  const run = getRun(runId);
  if (!run || run.terminal) return null;
  const seq = run.nextSeq;
  run.nextSeq += 1;
  const entry = { seq, event: event && { event: event.event, run_id: runId, timestamp: Date.now() / 1000, ...event } };
  if (event === null) run.terminal = true;
  run.events.push(entry);
  for (const notify of run.subscribers) notify(entry);
  return run;
}

const RUN_INTERNAL_KEYS = new Set(['events', 'nextSeq', 'terminal', 'subscribers', 'steers', 'input', 'cancelRequested']);

/** Lo que devuelve GET /v1/runs/{id}: el estado, sin el transporte. */
export function runStatus(run) {
  return Object.fromEntries(Object.entries(run).filter(([key]) => !RUN_INTERNAL_KEYS.has(key)));
}

export function completeRun(runId, status, extra = {}) {
  const run = getRun(runId);
  if (!run) return null;
  run.status = status;
  Object.assign(run, extra);
  return run;
}

function hashBody(body) {
  return JSON.stringify(body ?? {});
}

function pruneIdempotency() {
  const st = getState();
  const now = Date.now();
  for (const [key, rec] of st.idempotency) {
    if (now - rec.at > IDEMPOTENCY_TTL_MS) st.idempotency.delete(key);
  }
}

/** Test helper */
export function resetStore() {
  globalThis.__hermesMockState = undefined;
}
