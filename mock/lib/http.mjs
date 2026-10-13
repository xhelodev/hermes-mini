export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(payload);
}

export function openAiError(message, type = 'invalid_request_error', code = null) {
  return { error: { message, type, ...(code ? { code } : {}) } };
}

export async function readRawBody(req, maxBytes) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > maxBytes) {
    const err = new Error('payload_too_large');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('payload_too_large');
      err.code = 'PAYLOAD_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(buffer) {
  if (!buffer?.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

export function getRequestPath(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  return { pathname: url.pathname.replace(/\/+$/, '') || '/', searchParams: url.searchParams };
}
