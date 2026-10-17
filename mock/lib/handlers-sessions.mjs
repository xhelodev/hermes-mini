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
    const crashed = stream && getFault(req) === 'agenterror';
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
