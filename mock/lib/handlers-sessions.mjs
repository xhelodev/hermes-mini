import { randomUUID } from 'node:crypto';
import { openAiError, sendJson } from './http.mjs';
import { mockAssistantText, resolveRuntime } from './runtime.mjs';
import { initSse, sseWrite, startKeepalive } from './sse.mjs';
import {
  appendMessage,
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
  let data = params.get('order') === 'newest' ? [...s.messages].reverse() : s.messages;
  const limit = Number.parseInt(params.get('limit') || '', 10);
  if (limit > 0) data = data.slice(0, limit);
  sendJson(res, 200, { object: 'list', data });
}

export async function handleSessionChat(_req, res, id, body, { stream = false } = {}) {
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

  const runId = `run_${randomUUID().slice(0, 8)}`;
  try {
    appendMessage(id, { role: 'user', content: parsed.content });
    const runtime = resolveRuntime(body || {});
    const text = mockAssistantText(body || {}, runtime);
    appendMessage(id, { role: 'assistant', content: text });

    if (stream) {
      initSse(res);
      const stop = startKeepalive(res);
      sseWrite(res, { type: 'assistant.delta', run_id: runId, delta: text }, 'assistant.delta');
      sseWrite(res, { type: 'run.completed', run_id: runId, status: 'completed', runtime }, 'run.completed');
      clearInterval(stop);
      res.end();
      return;
    }

    sendJson(res, 200, {
      run_id: runId,
      status: 'completed',
      output: text,
      runtime,
    });
  } catch (e) {
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
