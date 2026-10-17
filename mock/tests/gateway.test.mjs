import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth, request, startTestServer } from './helpers.mjs';

process.env.MOCK_SLOW_WORD_MS = '30';

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

  it('session chat runs can be polled on /v1/runs/{id}, like Hermes', async () => {
    const created = await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} });
    const id = created.json.id;
    const runOf = async (extra) => {
      const r = await request(ctx.port, `/api/sessions/${id}/chat/stream`, {
        method: 'POST',
        headers: auth(extra),
        body: { input: 'hello' },
      });
      const runId = r.text.match(/"run_id":"([^"]+)"/)[1];
      return (await request(ctx.port, `/v1/runs/${runId}`, { headers: auth() })).json;
    };
    const ok = await runOf();
    assert.equal(ok.status, 'completed');
    assert.ok(ok.output);
    const crashed = await runOf({ 'X-Mock-Fault': 'agenterror' });
    assert.equal(crashed.status, 'failed');
    assert.match(crashed.error, /agent crashed/);
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

  describe('steer on a slow session stream', () => {
    // Abre el stream lento y espera el primer evento para tener el run_id.
    async function openSlowStream(sessionId) {
      const controller = new AbortController();
      const response = await fetch(`${ctx.url}/api/sessions/${sessionId}/chat/stream`, {
        method: 'POST',
        headers: { ...auth({ 'X-Mock-Fault': 'slowstream' }), 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
        signal: controller.signal,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!/"run_id":"/.test(text)) text += decoder.decode((await reader.read()).value);
      const runId = text.match(/"run_id":"([^"]+)"/)[1];
      const rest = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return text;
          text += decoder.decode(value);
        }
      })();
      return { runId, rest, abort: () => controller.abort() };
    }
    const steer = (runId, input) =>
      request(ctx.port, `/v1/runs/${runId}/steer`, { method: 'POST', headers: auth(), body: { input } });
    const newSession = async () =>
      (await request(ctx.port, '/api/sessions', { method: 'POST', headers: auth(), body: {} })).json.id;

    it('delivers an early steer as a steer row', async () => {
      const id = await newSession();
      const stream = await openSlowStream(id);
      const accepted = await steer(stream.runId, 'use docs');
      assert.equal(accepted.status, 200);
      assert.equal(accepted.json.accepted, true);
      const text = await stream.rest;
      assert.match(text, /corrección recibida: use docs/);
      assert.doesNotMatch(text, /"pending_steer"/);
      const msgs = (await request(ctx.port, `/api/sessions/${id}/messages`, { headers: auth() })).json.data;
      const row = msgs.find((m) => m.display_kind === 'steer');
      assert.match(row.content, /OUT-OF-BAND USER MESSAGE[\s\S]*use docs/);
      assert.equal(msgs.at(-1).role, 'assistant');
    });

    it('returns a late steer as pending_steer, and refuses one after the run ends', async () => {
      const id = await newSession();
      const stream = await openSlowStream(id);
      // Pasada la mitad del turno ya no se entrega.
      await new Promise((resolve) => setTimeout(resolve, 30 * 24));
      await steer(stream.runId, 'too late');
      const text = await stream.rest;
      assert.match(text, /"pending_steer":"too late"/);
      const refused = await steer(stream.runId, 'way too late');
      assert.equal(refused.status, 409);
      assert.equal(refused.json.error.code, 'run_not_accepting_steer');
    });

    it('cancels the run when the client disconnects', async () => {
      const id = await newSession();
      const stream = await openSlowStream(id);
      stream.abort();
      await stream.rest.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 30 * 3));
      const run = (await request(ctx.port, `/v1/runs/${stream.runId}`, { headers: auth() })).json;
      assert.equal(run.status, 'cancelled');
    });
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
