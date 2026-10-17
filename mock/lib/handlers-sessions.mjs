import { getFault } from './faults.mjs';
import { openAiError, sendJson } from './http.mjs';
import { mockAssistantText, resolveRuntime } from './runtime.mjs';
import { initSse, sseWrite, startKeepalive } from './sse.mjs';
import {
  appendMessage,
  completeRun,
  createRun,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  releaseRunSlot,
  tryAcquireRunSlot,
  updateSession,
} from './store.mjs';
import { validateMessageContent } from './content-validation.mjs';

function parseUserMessage(body) {
  const raw = body.message ?? body.input;
  if (raw == null) return { error: 'Missing message or input' };
  const contentErr = validateMessageContent(raw);
  if (contentErr) return { contentErr };
  return { content: raw };
}

export function handleListSessions(_req, res) {
  // Como Hermes: las archivadas no se listan, salvo las fijadas.
  const sessions = listSessions().filter((s) => !s.archived || s.pinned);
  sendJson(res, 200, { object: 'list', data: sessions });
}

export function handleCreateSession(_req, res, body) {
  const session = createSession(body || {});
  sendJson(res, 201, session);
}

export function handleGetSession(_req, res, id) {
  const s = getSession(id);
  if (!s) return sendJson(res, 404, openAiError('Session not found', 'not_found_error'));
  sendJson(res, 200, s);
}

export function handlePatchSession(_req, res, id, body) {
  const s = updateSession(id, body || {});
  if (!s) return sendJson(res, 404, openAiError('Session not found', 'not_found_error'));
  sendJson(res, 200, s);
}

export function handleDeleteSession(_req, res, id) {
  if (!deleteSession(id)) return sendJson(res, 404, openAiError('Session not found', 'not_found_error'));
  res.statusCode = 204;
  res.end();
}

export function handleSessionMessages(req, res, id) {
  const s = getSession(id);
  if (!s) return sendJson(res, 404, openAiError('Session not found', 'not_found_error'));
  const params = new URL(req.url || '/', 'http://mock').searchParams;
  const order = params.get('order');
  // Como Hermes: solo `oldest` o `latest`; `latest` toma la última página, en orden cronológico.
  if (order !== null && order !== 'oldest' && order !== 'latest') {
    return sendJson(
      res,
      400,
      openAiError('order must be one of: oldest, latest', 'invalid_request_error', 'invalid_pagination'),
    );
  }
  const limit = Number.parseInt(params.get('limit') || '', 10);
  let data = s.messages;
  if (limit > 0) data = order === 'latest' ? data.slice(-limit) : data.slice(0, limit);
  sendJson(res, 200, { object: 'list', data });
}

export async function handleSessionChat(req, res, id, body, { stream = false } = {}) {
  const s = getSession(id);
  if (!s) return sendJson(res, 404, openAiError('Session not found', 'not_found_error'));

  const parsed = parseUserMessage(body || {});
  if (parsed.error) return sendJson(res, 400, openAiError(parsed.error));
  if (parsed.contentErr) {
    return sendJson(res, 400, openAiError('unsupported_content_type', 'invalid_request_error', parsed.contentErr));
  }

  if (!tryAcquireRunSlot()) {
    return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
  }

  // Como Hermes: el turno queda consultable en GET /v1/runs/{id}.
  const runId = createRun({ session_id: id, input: parsed.content }).run.run_id;
  try {
    appendMessage(id, { role: 'user', content: parsed.content });
    const runtime = resolveRuntime(body || {});
    const text = mockAssistantText(body || {}, runtime);
    const fault = stream ? getFault(req) : '';
    const crashed = fault === 'agenterror';
    if (fault === 'slowstream') return await streamSlowly(res, id, runId, text, runtime);
    if (!crashed) appendMessage(id, { role: 'assistant', content: text });

    if (stream) {
      initSse(res);
      const stop = startKeepalive(res);
      if (crashed) {
        // Como Hermes cuando el agente lanza: `error` y `done`, sin `run.failed`.
        completeRun(runId, 'failed', { error: 'Fault injection: agent crashed' });
        sseWrite(res, { type: 'error', run_id: runId, message: 'Fault injection: agent crashed' }, 'error');
      } else {
        completeRun(runId, 'completed', { output: text, runtime });
        sseWrite(res, { type: 'assistant.delta', run_id: runId, delta: text }, 'assistant.delta');
        sseWrite(res, { type: 'run.completed', run_id: runId, status: 'completed', runtime }, 'run.completed');
      }
      sseWrite(res, { type: 'done', run_id: runId }, 'done');
      clearInterval(stop);
      res.end();
      return;
    }

    completeRun(runId, 'completed', { output: text, runtime });
    sendJson(res, 200, {
      run_id: runId,
      status: 'completed',
      output: text,
      runtime,
    });
  } catch (e) {
    completeRun(runId, 'failed', { error: String(e.message) });
    if (stream) {
      initSse(res);
      sseWrite(res, { type: 'run.failed', run_id: runId, error: String(e.message) }, 'run.failed');
      res.end();
    } else {
      sendJson(res, 500, openAiError('Run failed'));
    }
  } finally {
    releaseRunSlot();
  }
}

const STEER_OPEN =
  '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; ' +
  'not tool output and not a new delivery when replayed from conversation history]';
const STEER_CLOSE = '[/OUT-OF-BAND USER MESSAGE]';
const SLOW_FILLER =
  'Este turno avanza despacio para probar las correcciones: mandá una antes de la mitad y ' +
  'el agente la lee a mitad de camino; mandala después y vuelve como pending_steer al terminar.';
// Los tests lo bajan para no esperar segundos.
const slowWordMs = () => Number(process.env.MOCK_SLOW_WORD_MS) || 400;

/**
 * Turno lento (fault `slowstream`) para probar `/steer` y los cortes. Como Hermes: las
 * correcciones que llegan antes de la mitad se entregan (quedan como fila `steer` en el
 * historial), las que llegan después vuelven en `pending_steer`, y si el cliente se
 * desconecta el turno se detiene (`cancelled`).
 */
async function streamSlowly(res, sessionId, runId, text, runtime) {
  const run = completeRun(runId, 'running', { steers: [] });
  let closed = false;
  res.on('close', () => {
    closed = !res.writableFinished;
  });
  initSse(res);
  const stop = startKeepalive(res);
  // Largo a propósito: unas 30 palabras dan tiempo de mandar una corrección desde el teléfono.
  const words = `${text}\n\n${SLOW_FILLER}`.split(/(?<= )/);
  const checkpoint = Math.ceil(words.length / 2);
  let reply = '';
  let delivered = 0;
  for (const [index, word] of words.entries()) {
    if (closed) {
      clearInterval(stop);
      if (reply) appendMessage(sessionId, { role: 'assistant', content: reply });
      completeRun(runId, 'cancelled', { output: reply });
      return;
    }
    if (index === checkpoint && run.steers.length > 0) {
      const steer = run.steers.join('\n');
      delivered = run.steers.length;
      appendMessage(sessionId, { role: 'user', content: `${STEER_OPEN}\n${steer}\n${STEER_CLOSE}`, display_kind: 'steer' });
      const ack = `(corrección recibida: ${steer}) `;
      reply += ack;
      sseWrite(res, { type: 'assistant.delta', run_id: runId, delta: ack }, 'assistant.delta');
    }
    reply += word;
    sseWrite(res, { type: 'assistant.delta', run_id: runId, delta: word }, 'assistant.delta');
    await new Promise((resolve) => setTimeout(resolve, slowWordMs()));
  }
  appendMessage(sessionId, { role: 'assistant', content: reply });
  const late = run.steers.slice(delivered).join('\n');
  completeRun(runId, 'completed', { output: reply, runtime, ...(late ? { pending_steer: late } : {}) });
  sseWrite(
    res,
    { type: 'run.completed', run_id: runId, status: 'completed', runtime, ...(late ? { pending_steer: late } : {}) },
    'run.completed',
  );
  sseWrite(res, { type: 'done', run_id: runId }, 'done');
  clearInterval(stop);
  res.end();
}
