import http from 'node:http';
import { handleRequest } from '../lib/router.mjs';
import { resetStore } from '../lib/store.mjs';

export const BASE = 'http://127.0.0.1';
export const KEY = 'mock-test-key';

export function startTestServer() {
  resetStore();
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `${BASE}:${port}` });
    });
  });
}

export async function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
  const res = await fetch(`${BASE}:${port}${path}`, {
    method,
    headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}),
      ...headers,
    },
    body: payload,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json, text };
}

export function auth(extra = {}) {
  return { Authorization: `Bearer ${KEY}`, ...extra };
}

export function multipartFile(port, path, { filename, content, contentType = 'application/octet-stream', headers = {} }) {
  const boundary = '----mockboundary';
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return fetch(`${BASE}:${port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(Buffer.byteLength(body)),
      ...headers,
    },
    body,
  }).then(async (res) => {
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json, text };
  });
}
