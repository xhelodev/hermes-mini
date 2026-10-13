import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { auth, multipartFile, startTestServer } from './helpers.mjs';

describe('Document converter mock', () => {
  let ctx;

  before(async () => {
    ctx = await startTestServer();
  });

  after(() => ctx.server.close());

  it('returns 401 without Authorization', async () => {
    const r = await multipartFile(ctx.port, '/convert', {
      filename: 'doc.txt',
      content: 'hello',
      contentType: 'text/plain',
    });
    assert.equal(r.status, 401);
    assert.match(r.json.error.message, /Missing Bearer/);
  });

  it('returns 401 with wrong key', async () => {
    const r = await multipartFile(ctx.port, '/convert', {
      filename: 'doc.txt',
      content: 'hello',
      contentType: 'text/plain',
      headers: { Authorization: 'Bearer not-the-key' },
    });
    assert.equal(r.status, 401);
    assert.match(r.json.error.message, /Invalid API key/);
  });

  it('returns markdown fixture for txt', async () => {
    const r = await multipartFile(ctx.port, '/convert', {
      filename: 'notes.txt',
      content: 'hello',
      contentType: 'text/plain',
      headers: auth(),
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.markdown.includes('Plain text'));
  });

  it('returns 415 for video', async () => {
    const r = await multipartFile(ctx.port, '/convert', {
      filename: 'clip.mp4',
      content: 'fake',
      contentType: 'video/mp4',
      headers: auth(),
    });
    assert.equal(r.status, 415);
    assert.equal(r.json.error.code, 'unsupported_media_type');
    assert.match(r.json.error.message, /video/i);
  });

  it('returns 415 for unknown extension with clear message', async () => {
    const r = await multipartFile(ctx.port, '/convert', {
      filename: 'data.bin',
      content: 'x',
      headers: auth(),
    });
    assert.equal(r.status, 415);
    assert.match(r.json.error.message, /Supported: pdf/);
  });

  it('fault scanned returns 422 no_text for pdf', async () => {
    const r = await multipartFile(ctx.port, '/convert?fault=scanned', {
      filename: 'scan.pdf',
      content: '%PDF',
      contentType: 'application/pdf',
      headers: auth(),
    });
    assert.equal(r.status, 422);
    assert.equal(r.json.error, 'no_text');
  });

  it('fault down returns 503', async () => {
    const r = await multipartFile(ctx.port, '/convert?fault=down', {
      filename: 'a.txt',
      content: 'x',
      contentType: 'text/plain',
      headers: auth(),
    });
    assert.equal(r.status, 503);
  });
});
