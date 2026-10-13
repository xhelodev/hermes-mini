import { randomUUID } from 'node:crypto';
import { VIRTUAL_MODEL } from './constants.mjs';
import { validateMessages } from './content-validation.mjs';
import { openAiError, sendJson } from './http.mjs';
import { mockAssistantText, resolveRuntime } from './runtime.mjs';
import { initSse, openAiChunk, sseWrite, startKeepalive } from './sse.mjs';
import { releaseRunSlot, tryAcquireRunSlot } from './store.mjs';
import { getFault } from './faults.mjs';

export async function handleChatCompletions(req, res, body) {
  const fault = getFault(req);
  if (fault === 'cut' && body.stream) {
    if (!tryAcquireRunSlot()) {
      return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
    }
    const id = `chatcmpl-${randomUUID().slice(0, 8)}`;
    const runtime = resolveRuntime(body);
    const model = body.model || VIRTUAL_MODEL;
    initSse(res);
    const stop = startKeepalive(res);
    sseWrite(res, openAiChunk(id, model, 'partial '));
    res.destroy();
    clearInterval(stop);
    releaseRunSlot();
    return;
  }

  const contentErr = validateMessages(body.messages);
  if (contentErr) {
    return sendJson(res, 400, openAiError('unsupported_content_type', 'invalid_request_error', contentErr));
  }

  if (!tryAcquireRunSlot()) {
    return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
  }

  try {
    const runtime = resolveRuntime(body);
    const model = body.model || VIRTUAL_MODEL;
    const text = mockAssistantText(body, runtime);
    const id = `chatcmpl-${randomUUID().slice(0, 8)}`;

    if (body.stream) {
      initSse(res);
      const stop = startKeepalive(res);
      const parts = text.split(' ');
      for (const p of parts) {
        sseWrite(res, { ...openAiChunk(id, model, `${p} `), runtime });
      }
      sseWrite(res, { ...openAiChunk(id, model, '', 'stop'), runtime });
      sseWrite(res, '[DONE]');
      clearInterval(stop);
      res.end();
      return;
    }

    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      runtime,
    });
  } finally {
    releaseRunSlot();
  }
}
