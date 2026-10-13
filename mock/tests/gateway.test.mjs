import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth, request, startTestServer } from './helpers.mjs';

describe('Hermes mock gateway', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(() => ctx.server.close());

  it('GET /health is unauthenticated', async () => {
    const r = await request(ctx.port, '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { status: 'ok' });
  });

  it('rejects missing API key', async () => {
    const r = await request(ctx.port, '/v1/models');
    assert.equal(r.status, 401);
  });

  it('rejects wrong API key', async () => {
    const r = await request(ctx.port, '/v1/models', { headers: { Authorization: 'Bearer wrong' } });
    assert.equal(r.status, 401);
  });

  it('GET /v1/models returns hermes-agent alias only', async () => {
    const r = await request(ctx.port, '/v1/models', { headers: auth() });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.length, 1);
    assert.equal(r.json.data[0].id, 'hermes-agent');
  });

  it('GET /api/model/options returns providers', async () => {
    const r = await request(ctx.port, '/api/model/options', { headers: auth() });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.providers));
  });

  it('chat completions honors model only with provider', async () => {
    const r1 = await request(ctx.port, '/v1/chat/completions', {
      method: 'POST',
      headers: auth(),
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(r1.json.runtime.model, 'hermes-agent');

    const r2 = await request(ctx.port, '/v1/chat/completions', {
      method: 'POST',
      headers: auth(),
      body: {
        model: 'gpt-4o',
        provider: 'openai',
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    assert.equal(r2.json.runtime.model, 'gpt-4o');
    assert.equal(r2.json.runtime.provider, 'openai');
  });

  it('rejects unsupported content parts', async () => {
    const r = await request(ctx.port, '/v1/chat/completions', {
      method: 'POST',
      headers: auth(),
      body: {
        messages: [{ role: 'user', content: [{ type: 'file', file: { filename: 'x.pdf' } }] }],
      },
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'unsupported_content_type');
  });

  it('session lifecycle and chat', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} });
    const id = created.json.id;
    const chat = await request(ctx.port, `/api/sessions/${id}/chat`, {
      method: 'POST',
      headers: auth(),
      body: { message: 'hello' },
    });
    assert.equal(chat.status, 200);
    assert.ok(chat.json.output);
    const msgs = await request(ctx.port, `/api/sessions/${id}/messages`, { headers: auth() });
    assert.equal(msgs.json.data.length, 2);
  });

  it('run idempotency replays same run_id', async () => {
    const headers = auth({ 'Idempotency-Key': 'idem-1' });
    const a = await request(ctx.port, '/v1/runs', { method: 'POST', headers, body: { input: 'x' } });
    const b = await request(ctx.port, '/v1/runs', { method: 'POST', headers, body: { input: 'x' } });
    assert.equal(a.json.run_id, b.json.run_id);
    assert.equal(b.headers.get('idempotency-replayed'), 'true');
  });

  it('fault injection 401 via header', async () => {
    const r = await request(ctx.port, '/v1/models', { headers: auth({ 'X-Mock-Fault': '401' }) });
    assert.equal(r.status, 401);
  });
});
