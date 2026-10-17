import { getFault } from './faults.mjs';
import { openAiError, sendJson } from './http.mjs';
import { mockAssistantText, resolveRuntime } from './runtime.mjs';
import { initSse, sseComment, startKeepalive } from './sse.mjs';
import {
  appendMessage,
  completeRun,
  createRun,
  getRun,
  getSession,
  pushRunEvent,
  releaseRunSlot,
  tryAcquireRunSlot,
} from './store.mjs';

const DELTA_SIZE = 24;

function runNotFound(res, runId) {
  return sendJson(res, 404, openAiError(`Run not found: ${runId}`, 'invalid_request_error', 'run_not_found'));
}

/** Como Hermes 0.22: el JSON lleva `event`, `run_id`, `timestamp` y `seq`, sin línea `event:`. */
function runEvent(run, event, fields = {}) {
  const payload = { event, run_id: run.run_id, timestamp: Date.now() / 1000, ...fields, seq: run.events.length };
  pushRunEvent(run.run_id, payload);
}

function writeRunEvent(res, payload) {
  res.write(`id: ${payload.seq}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function handleCreateRun(req, res, body) {
  const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
  const result = createRun(body || {}, key);
  if (result.conflict) {
    return sendJson(res, 409, openAiError('idempotency_key_conflict', 'invalid_request_error', 'idempotency_key_conflict'));
  }
  if (result.replay) {
    return sendJson(
      res,
      202,
      { run_id: result.run.run_id, status: result.run.status, replayed: true },
      { 'Idempotency-Replayed': 'true' },
    );
  }

  if (!tryAcquireRunSlot()) {
    return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
  }

  // El run corre aparte de quien lea sus eventos: queda completo antes de responder.
  const run = result.run;
  const input = typeof body?.input === 'string' ? body.input : '';
  const session = run.session_id ? getSession(run.session_id) : null;
  if (session && input) appendMessage(session.id, { role: 'user', content: input });

  if (getFault(req) === 'agenterror') {
    const error = 'Fault injection: agent crashed';
    completeRun(run.run_id, 'failed', { error });
    runEvent(run, 'run.failed', { error });
  } else {
    const runtime = resolveRuntime(body || {});
    const output = mockAssistantText(body || {}, runtime);
    for (let i = 0; i < output.length; i += DELTA_SIZE) {
      runEvent(run, 'message.delta', { delta: output.slice(i, i + DELTA_SIZE) });
    }
    const usage = { input_tokens: 5, output_tokens: 15, total_tokens: 20 };
    completeRun(run.run_id, 'completed', { output, runtime, usage, completed: true, partial: false, interrupted: false });
    runEvent(run, 'run.completed', { output, usage, runtime, completed: true, partial: false, interrupted: false });
    if (session) appendMessage(session.id, { role: 'assistant', content: output, finish_reason: 'stop' });
  }
  releaseRunSlot();

  sendJson(res, 202, { run_id: run.run_id, status: 'started', replayed: false });
}

export function handleGetRun(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return runNotFound(res, runId);
  const { events: _events, input: _input, ...status } = run;
  sendJson(res, 200, { ...status, last_event: run.events.at(-1)?.event ?? null });
}

/** Repite los eventos posteriores a `last_seq` (o `Last-Event-ID`) y cierra, como un run ya terminado. */
export function handleRunEvents(req, res, runId) {
  const run = getRun(runId);
  if (!run) return runNotFound(res, runId);

  const url = new URL(req.url || '/', 'http://localhost');
  const raw = req.headers['last-event-id'] ?? url.searchParams.get('last_seq');
  const lastSeq = Number.parseInt(raw ?? '-1', 10);

  initSse(res);
  sseComment(res, 'open');
  const stop = startKeepalive(res);
  for (const payload of run.events) {
    if (payload.seq > (Number.isNaN(lastSeq) ? -1 : lastSeq)) writeRunEvent(res, payload);
  }
  sseComment(res, 'stream closed');
  clearInterval(stop);
  res.end();
}

export function handleRunStop(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return runNotFound(res, runId);
  if (['completed', 'failed', 'cancelled'].includes(run.status)) {
    return sendJson(res, 200, run);
  }
  completeRun(runId, 'cancelled');
  runEvent(run, 'run.cancelled');
  sendJson(res, 200, { run_id: runId, status: 'stopping' });
}
