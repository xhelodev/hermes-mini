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
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

const STEER_OPEN =
  '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; ' +
  'not tool output and not a new delivery when replayed from conversation history]';
const STEER_CLOSE = '[/OUT-OF-BAND USER MESSAGE]';
const SLOW_FILLER =
  'Este turno avanza despacio para probar las correcciones: mandá una antes de la mitad y ' +
  'el agente la lee a mitad de camino; mandala después y vuelve como pending_steer al terminar.';
// Los tests lo bajan para no esperar segundos.
const slowWordMs = () => Number(process.env.MOCK_SLOW_WORD_MS) || 400;

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

  if (getFault(req) === 'slowstream') {
    // Sigue corriendo después de responder, como un run real: se puede corregir y detener.
    void playSlowRun(run, session, mockAssistantText(body || {}, resolveRuntime(body || {})), resolveRuntime(body || {}));
    return sendJson(res, 202, { run_id: run.run_id, status: 'started', replayed: false });
  }

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

/**
 * Turno lento (fault `slowstream`), palabra por palabra. Como Hermes: las correcciones que
 * llegan antes de la mitad se entregan (quedan como fila `steer` en el historial) y las que
 * llegan después vuelven en `pending_steer`; `/stop` lo corta.
 */
async function playSlowRun(run, session, text, runtime) {
  completeRun(run.run_id, 'running', { steers: [] });
  const words = `${text}\n\n${SLOW_FILLER}`.split(/(?<= )/);
  const checkpoint = Math.ceil(words.length / 2);
  let output = '';
  let delivered = 0;
  try {
    for (const [index, word] of words.entries()) {
      if (run.status !== 'running') {
        if (output && session) appendMessage(session.id, { role: 'assistant', content: output });
        return;
      }
      if (index === checkpoint && run.steers.length > 0) {
        const steer = run.steers.join('\n');
        delivered = run.steers.length;
        if (session) {
          appendMessage(session.id, { role: 'user', content: `${STEER_OPEN}\n${steer}\n${STEER_CLOSE}`, display_kind: 'steer' });
        }
        const ack = `(corrección recibida: ${steer}) `;
        output += ack;
        runEvent(run, 'message.delta', { delta: ack });
      }
      output += word;
      runEvent(run, 'message.delta', { delta: word });
      await new Promise((resolve) => setTimeout(resolve, slowWordMs()));
    }
    const late = run.steers.slice(delivered).join('\n');
    const fields = { output, runtime, completed: true, partial: false, interrupted: false, ...(late ? { pending_steer: late } : {}) };
    completeRun(run.run_id, 'completed', fields);
    runEvent(run, 'run.completed', fields);
    if (session) appendMessage(session.id, { role: 'assistant', content: output, finish_reason: 'stop' });
  } finally {
    releaseRunSlot();
  }
}

export function handleRunSteer(_req, res, runId, body) {
  const run = getRun(runId);
  if (!run) return runNotFound(res, runId);
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

export function handleGetRun(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return runNotFound(res, runId);
  const { events: _events, input: _input, subscribers: _subscribers, steers: _steers, ...status } = run;
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
  const close = () => {
    run.subscribers?.delete(notify);
    clearInterval(stop);
  };
  const notify = (payload) => {
    writeRunEvent(res, payload);
    if (!TERMINAL_STATUSES.has(run.status)) return;
    sseComment(res, 'stream closed');
    close();
    res.end();
  };
  // Un run que sigue corriendo (`slowstream`) manda lo nuevo en vivo hasta terminar.
  if (!TERMINAL_STATUSES.has(run.status)) {
    (run.subscribers ??= new Set()).add(notify);
    res.on('close', close);
    return;
  }
  sseComment(res, 'stream closed');
  close();
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
