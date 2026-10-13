import { requireAuth } from './auth.mjs';
import { MAX_CHAT_BODY_BYTES, DEFAULT_MODEL_OPTIONS, VIRTUAL_MODEL } from './constants.mjs';
import { handleConvert } from './convert.mjs';
import { faultResponse, getFault, parseCustomModelOptions } from './faults.mjs';
import { handleChatCompletions } from './handlers-chat.mjs';
import {
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessions,
  handlePatchSession,
  handleSessionChat,
  handleSessionMessages,
} from './handlers-sessions.mjs';
import { handleCreateRun, handleGetRun, handleRunEvents, handleRunStop } from './handlers-runs.mjs';
import { getRequestPath, openAiError, parseJsonBody, readRawBody, sendJson } from './http.mjs';
import { getModelOptionsOverride, setModelOptionsOverride } from './store.mjs';

const UPLOAD_PATHS = ['/v1/artifacts/upload', '/upload'];

export async function handleRequest(req, res) {
  const { pathname } = getRequestPath(req);
  const method = (req.method || 'GET').toUpperCase();
  const fault = getFault(req);

  const customOptions = parseCustomModelOptions(fault);
  if (customOptions) setModelOptionsOverride(customOptions);

  const injected = faultResponse(fault);
  if (injected?.status && pathname !== '/health' && pathname !== '/convert') {
    return sendJson(res, injected.status, injected.body);
  }
  if (injected?.kind === 'timeout' && pathname !== '/convert') {
    await new Promise(() => {});
    return;
  }

  if (method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if (method === 'POST' && pathname === '/convert') {
    return handleConvert(req, res);
  }

  if (UPLOAD_PATHS.some((p) => pathname === p || pathname.endsWith(p))) {
    return sendJson(res, 404, openAiError('Upload endpoint not available on mock'));
  }

  const isHealth = pathname === '/health';
  const authErr = requireAuth(req, { allowUnauthenticated: isHealth });
  if (authErr) return sendJson(res, authErr.status, authErr.body);

  if (method === 'GET' && pathname === '/v1/models') {
    return sendJson(res, 200, {
      object: 'list',
      data: [{ id: VIRTUAL_MODEL, object: 'model', owned_by: 'hermes-agent' }],
    });
  }

  if (method === 'GET' && pathname === '/api/model/options') {
    const payload = getModelOptionsOverride() || DEFAULT_MODEL_OPTIONS;
    return sendJson(res, 200, payload);
  }

  let body = {};
  const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
  if (needsBody) {
    try {
      const raw = await readRawBody(req, MAX_CHAT_BODY_BYTES);
      body = parseJsonBody(raw);
    } catch (e) {
      if (e.code === 'PAYLOAD_TOO_LARGE' || fault === 'toolarge') {
        return sendJson(res, 413, openAiError('Request body too large (max 10 MB)'));
      }
      if (e instanceof SyntaxError) {
        return sendJson(res, 400, openAiError('Invalid JSON body'));
      }
      throw e;
    }
  }

  if (method === 'POST' && pathname === '/v1/chat/completions') {
    return handleChatCompletions(req, res, body);
  }

  if (method === 'GET' && pathname === '/api/sessions') {
    return handleListSessions(req, res);
  }
  if (method === 'POST' && pathname === '/api/sessions') {
    return handleCreateSession(req, res, body);
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
  if (sessionMatch) {
    const sessionId = sessionMatch[1];
    const sub = sessionMatch[2] || '';

    if (method === 'GET' && sub === '') return handleGetSession(req, res, sessionId);
    if (method === 'PATCH' && sub === '') return handlePatchSession(req, res, sessionId, body);
    if (method === 'DELETE' && sub === '') return handleDeleteSession(req, res, sessionId);
    if (method === 'GET' && sub === '/messages') return handleSessionMessages(req, res, sessionId);
    if (method === 'POST' && sub === '/chat') return handleSessionChat(req, res, sessionId, body, { stream: false });
    if (method === 'POST' && sub === '/chat/stream') {
      return handleSessionChat(req, res, sessionId, body, { stream: true });
    }
  }

  if (method === 'POST' && pathname === '/v1/runs') {
    return handleCreateRun(req, res, body);
  }

  const runMatch = pathname.match(/^\/v1\/runs\/([^/]+)(\/.*)?$/);
  if (runMatch) {
    const runId = runMatch[1];
    const sub = runMatch[2] || '';
    if (method === 'GET' && sub === '') return handleGetRun(req, res, runId);
    if (method === 'GET' && sub === '/events') return handleRunEvents(req, res, runId);
    if (method === 'POST' && sub === '/stop') return handleRunStop(req, res, runId);
  }

  return sendJson(res, 404, openAiError(`Route not found: ${method} ${pathname}`));
}
