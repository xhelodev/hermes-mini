import { KEEPALIVE_INTERVAL_MS } from './constants.mjs';

export function initSse(res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

export function sseWrite(res, data, event) {
  if (event) res.write(`event: ${event}\n`);
  const payload = data === '[DONE]' ? '[DONE]' : typeof data === 'string' ? data : JSON.stringify(data);
  res.write(`data: ${payload}\n\n`);
}

export function sseComment(res, text) {
  res.write(`: ${text}\n\n`);
}

export function startKeepalive(res) {
  return setInterval(() => {
    try {
      sseComment(res, 'keepalive');
    } catch {
      /* closed */
    }
  }, KEEPALIVE_INTERVAL_MS);
}

export function openAiChunk(id, model, delta, finish = null) {
  const choice = { index: 0, delta: { role: 'assistant', content: delta } };
  if (finish) choice.finish_reason = finish;
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
  };
}
