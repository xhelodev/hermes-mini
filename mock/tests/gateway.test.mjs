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

  it('messages accept only oldest or latest order, like Hermes', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} });
    const id = created.json.id;
    await request(ctx.port, `/api/sessions/${id}/chat`, { method: 'POST', headers: auth(), body: { message: 'hello' } });
    const last = await request(ctx.port, `/api/sessions/${id}/messages?order=latest&limit=1`, { headers: auth() });
    assert.equal(last.status, 200);
    assert.equal(last.json.data.length, 1);
    assert.equal(last.json.data[0].role, 'assistant');
    const first = await request(ctx.port, `/api/sessions/${id}/messages?order=oldest&limit=1`, { headers: auth() });
    assert.equal(first.json.data[0].role, 'user');
    const bad = await request(ctx.port, `/api/sessions/${id}/messages?order=newest&limit=1`, { headers: auth() });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_pagination');
  });

  it('chat stream ends with done, and an agent crash sends error without run.failed', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} });
    const id = created.json.id;
    const events = async (extra) => {
      const r = await request(ctx.port, `/api/sessions/${id}/chat/stream`, {
        method: 'POST',
        headers: auth(extra),
        body: { input: 'hello' },
      });
      return [...r.text.matchAll(/^event: (.+)$/gm)].map((m) => m[1]);
    };
    assert.deepEqual(await events(), ['assistant.delta', 'run.completed', 'done']);
    assert.deepEqual(await events({ 'X-Mock-Fault': 'agenterror' }), ['error', 'done']);
  });

  it('archived sessions leave the list until unarchived', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} });
    const id = created.json.id;
    const listed = async () =>
      (await request(ctx.port, '/api/sessions', { headers: auth() })).json.data.some((s) => s.id === id);
    const patch = (body) => request(ctx.port, `/api/sessions/${id}`, { method: 'PATCH', headers: auth(), body });
    assert.equal(await listed(), true);
    assert.equal((await patch({ archived: true })).json.archived, true);
    assert.equal(await listed(), false);
    const fetched = await request(ctx.port, `/api/sessions/${id}`, { headers: auth() });
    assert.equal(fetched.json.archived, true);
    await patch({ archived: false });
    assert.equal(await listed(), true);
  });

  it('run idempotency replays same run_id', async () => {
    const headers = auth({ 'Idempotency-Key': 'idem-1' });
    const a = await request(ctx.port, '/v1/runs', { method: 'POST', headers, body: { input: 'x' } });
    const b = await request(ctx.port, '/v1/runs', { method: 'POST', headers, body: { input: 'x' } });
    assert.equal(a.json.run_id, b.json.run_id);
    assert.equal(b.headers.get('idempotency-replayed'), 'true');
  });

  it('runs attach to a session and replay events after last_seq', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: { title: 'Runs' } });
    const sessionId = created.json.session?.id ?? created.json.id;
    const run = await request(ctx.port, '/v1/runs', {
      method: 'POST',
      headers: auth({ 'Idempotency-Key': 'idem-run-session' }),
      body: { input: 'hola', session_id: sessionId },
    });
    assert.equal(run.status, 202);
    const runId = run.json.run_id;

    const frames = (text) =>
      text
        .split('\n\n')
        .filter((block) => block.includes('data: '))
        .map((block) => JSON.parse(block.slice(block.indexOf('data: ') + 6)));
    const all = frames((await request(ctx.port, `/v1/runs/${runId}/events`, { headers: auth() })).text);
    assert.equal(all.at(-1).event, 'run.completed');
    assert.ok(all.every((event, index) => event.seq === index));
    assert.ok(!(await request(ctx.port, `/v1/runs/${runId}/events`, { headers: auth() })).text.includes('event:'));

    const rest = frames((await request(ctx.port, `/v1/runs/${runId}/events?last_seq=0`, { headers: auth() })).text);
    assert.equal(rest[0].seq, 1);
    assert.equal(rest.map((event) => event.delta ?? '').join(''), all.map((event) => event.delta ?? '').join('').slice(all[0].delta.length));

    const status = await request(ctx.port, `/v1/runs/${runId}`, { headers: auth() });
    assert.equal(status.json.status, 'completed');
    assert.equal(status.json.output, all.at(-1).output);

    const messages = await request(ctx.port, `/api/sessions/${sessionId}/messages`, { headers: auth() });
    const last = messages.json.data.at(-1);
    assert.equal(last.role, 'assistant');
    assert.equal(last.finish_reason, 'stop');
  });

  it('runs report agent crashes as run.failed', async () => {
    const run = await request(ctx.port, '/v1/runs?fault=agenterror', { method: 'POST', headers: auth(), body: { input: 'x' } });
    const status = await request(ctx.port, `/v1/runs/${run.json.run_id}`, { headers: auth() });
    assert.equal(status.json.status, 'failed');
    const missing = await request(ctx.port, '/v1/runs/nope/events', { headers: auth() });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'run_not_found');
  });

  it('fault injection 401 via header', async () => {
    const r = await request(ctx.port, '/v1/models', { headers: auth({ 'X-Mock-Fault': '401' }) });
    assert.equal(r.status, 401);
  });
});
