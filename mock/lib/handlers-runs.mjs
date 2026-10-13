import { randomUUID } from 'node:crypto';
import { openAiError, sendJson } from './http.mjs';
import { mockAssistantText, resolveRuntime } from './runtime.mjs';
import { initSse, sseWrite, startKeepalive } from './sse.mjs';
import {
  completeRun,
  createRun,
  getRun,
  pushRunEvent,
  releaseRunSlot,
  tryAcquireRunSlot,
} from './store.mjs';

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
      { run_id: result.run.run_id, status: result.run.status },
      { 'Idempotency-Replayed': 'true' },
    );
  }

  if (!tryAcquireRunSlot()) {
    return sendJson(res, 429, openAiError('Too many concurrent runs', 'rate_limit_error'));
  }

  const run = result.run;
  const runtime = resolveRuntime(body || {});
  const output = mockAssistantText(body || {}, runtime);
  completeRun(run.run_id, 'completed', {
    output,
    runtime,
    usage: { input_tokens: 5, output_tokens: 15, total_tokens: 20 },
  });
  pushRunEvent(run.run_id, { type: 'run.completed', status: 'completed', output, runtime });
  releaseRunSlot();

  sendJson(res, 202, { run_id: run.run_id, status: 'started' });
}

export function handleGetRun(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError('Run not found', 'not_found_error'));
  sendJson(res, 200, run);
}

export function handleRunEvents(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError('Run not found', 'not_found_error'));

  initSse(res);
  const stop = startKeepalive(res);
  for (const ev of run.events) {
    sseWrite(res, ev, ev.type || 'message');
  }
  if (run.status === 'completed') {
    sseWrite(res, { type: 'run.completed', run_id: runId, output: run.output, runtime: run.runtime }, 'run.completed');
  }
  clearInterval(stop);
  res.end();
}

export function handleRunStop(_req, res, runId) {
  const run = getRun(runId);
  if (!run) return sendJson(res, 404, openAiError('Run not found', 'not_found_error'));
  completeRun(runId, 'cancelled');
  pushRunEvent(runId, { type: 'run.cancelled', run_id: runId });
  sendJson(res, 200, { status: 'stopping' });
}
