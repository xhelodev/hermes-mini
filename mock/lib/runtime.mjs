import { VIRTUAL_MODEL } from './constants.mjs';

export function resolveRuntime(body, virtualModel = VIRTUAL_MODEL) {
  const provider = clean(body?.provider);
  const model = clean(body?.model);
  const runtime = {
    provider: provider || 'mock',
    model: model && provider ? model : virtualModel,
    route_source: provider ? 'raw_request' : 'global',
  };
  if (provider && model) {
    runtime.requested = { provider, model };
  }
  return runtime;
}

function clean(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

export function mockAssistantText(body, runtime) {
  const userBit =
    typeof body?.input === 'string'
      ? body.input
      : body?.messages?.filter((m) => m.role === 'user').pop()?.content;
  const preview =
    typeof userBit === 'string' ? userBit.slice(0, 80) : 'Hello from the Hermes mock gateway.';
  return `[mock] provider=${runtime.provider} model=${runtime.model}: ${preview}`;
}
