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
  runStatus,
  tryAcquireRunSlot,
} from './store.mjs';
import { playSlowTurn } from './turns.mjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** Como `_run_user_message` de Hermes: un texto, o el `content` del último mensaje de una lista. */
function runUserMessage(input) {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.at(-1)?.content ?? '';
  return '';
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
  const userMessage = runUserMessage(body?.input);
  if (!userMessage) return sendJson(res, 400, openAiError("Missing 'input' field"));

  if (!tryAcquireRunSlot()) {
    return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
  }

  const run = result.run;
  // Como Hermes con `session_id`: el turno se guarda en esa conversación.
  const sessionId = body?.session_id && getSession(body.session_id) ? body.session_id : null;
  if (sessionId) appendMessage(sessionId, { role: 'user', content: userMessage });
  const runtime = resolveRuntime(body || {});
  const text = mockAssistantText({ ...body, input: typeof userMessage === 'string' ? userMessage : '' }, runtime);
  // Sin falla corre entero antes de responder (sin `await`), así anda igual en Vercel.
  void executeRun(run, { sessionId, text, runtime, fault: getFault(req) });
  sendJson(res, 202, { run_id: run.run_id, status: 'started', replayed: false });
}

function finishRun(run, status, fields = {}) {
  const terminal = {
    completed: status === 'completed',
    partial: false,
    interrupted: status === 'cancelled',
    ...fields,
  };
  completeRun(run.run_id, status, { ...terminal, last_event: `run.${status}` });
  pushRunEvent(run.run_id, { event: `run.${status}`, ...terminal });
  pushRunEvent(run.run_id, null);
}

async function executeRun(run, { sessionId, text, runtime, fault }) {
  const runId = run.run_id;
  try {
    completeRun(runId, 'running');
    if (fault === 'agenterror') {
      finishRun(run, 'failed', { error: 'Fault injection: agent crashed' });
      return;
    }
    if (fault === 'slowstream') {
      const { reply, late, cancelled } = await playSlowTurn({
        run,
        sessionId,
        text,
        emitDelta: (delta) => pushRunEvent(runId, { event: 'message.delta', delta }),
        stopped: () => run.cancelRequested === true,
      });
      if (cancelled) {
        finishRun(run, 'cancelled', { output: reply });
        return;
      }
      finishRun(run, 'completed', { output: reply, runtime, ...(late ? { pending_steer: late } : {}) });
      return;
    }
    pushRunEvent(runId, { event: 'message.delta', delta: text });
    if (sessionId) appendMessage(sessionId, { role: 'assistant', content: text });
    finishRun(run, 'completed', {
      output: text,
      runtime,
      usage: { input_tokens: 5, output_tokens: 15, total_tokens: 20 },
    });
  } finally {
    releaseRunSlot();
  }
}

export function handleGetRun(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError(`Run not found: ${runId}`, 'not_found_error', 'run_not_found'));
  sendJson(res, 200, runStatus(run));
}

function writeEntry(res, entry) {
  res.write(`id: ${entry.seq}\ndata: ${JSON.stringify({ ...entry.event, seq: entry.seq })}\n\n`);
}

/**
 * Como `GET /v1/runs/{id}/events` de Hermes: reenvía lo que haya después de `Last-Event-ID`
 * (o `?last_seq=`) y sigue en vivo hasta que el turno termina. Desconectarse no corta el turno.
 * La falla `cut` cierra la conexión después del primer evento, para probar la reconexión.
 */
export function handleRunEvents(req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError(`Run not found: ${runId}`, 'not_found_error', 'run_not_found'));
  const url = new URL(req.url || '/', 'http://mock');
  const raw = req.headers['last-event-id'] ?? url.searchParams.get('last_seq');
  const parsed = raw == null ? Number.NaN : Number.parseInt(String(raw), 10);
  const lastSeq = Number.isNaN(parsed) ? -1 : Math.max(-1, parsed);
  const cut = getFault(req) === 'cut';

  initSse(res);
  sseComment(res, 'open');
  const write = (entry) => {
    if (entry.event === null) {
      sseComment(res, 'stream closed');
      res.end();
      return false;
    }
    writeEntry(res, entry);
    if (cut) {
      // Cierra sin evento final: el cliente tiene que reconectarse.
      res.end();
      return false;
    }
    return true;
  };
  for (const entry of run.events) {
    if (entry.seq <= lastSeq) continue;
    if (!write(entry)) return;
  }
  if (run.terminal) {
    res.end();
    return;
  }
  const stop = startKeepalive(res);
  const notify = (entry) => {
    if (!write(entry)) {
      run.subscribers.delete(notify);
      clearInterval(stop);
    }
  };
  run.subscribers.add(notify);
  res.on('close', () => {
    run.subscribers.delete(notify);
    clearInterval(stop);
  });
}

export function handleRunStop(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError(`Run not found: ${runId}`, 'not_found_error', 'run_not_found'));
  if (!TERMINAL.has(run.status)) {
    run.cancelRequested = true;
    completeRun(runId, 'stopping', { last_event: 'run.stopping' });
  }
  sendJson(res, 200, runStatus(run));
}

export function handleRunSteer(_req, res, runId, body) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError('Run not found', 'not_found_error', 'run_not_found'));
  if (run.status !== 'running') {
    return sendJson(
      res,
      409,
      openAiError(`Run is not currently accepting steer input: ${runId}`, 'invalid_request_error', 'run_not_accepting_steer'),
    );
  }
  const text = String(body?.input || body?.message || body?.text || '').trim();
  if (!text) {
    return sendJson(
      res,
      400,
      openAiError("Missing non-empty steer text; expected 'input', 'message', or 'text'.", 'invalid_request_error', 'invalid_steer_input'),
    );
  }
  run.steers.push(text);
  sendJson(res, 200, { object: 'hermes.run.steer', run_id: runId, accepted: true });
}
