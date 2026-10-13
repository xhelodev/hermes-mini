import { MOCK_API_KEY } from './constants.mjs';

export function parseBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function requireAuth(req, { allowUnauthenticated = false } = {}) {
  if (allowUnauthenticated) return null;
  const token = parseBearer(req.headers.authorization || req.headers.Authorization);
  if (!token || token !== MOCK_API_KEY) {
    return { status: 401, body: { error: { message: 'Invalid API key', type: 'invalid_api_key' } } };
  }
  return null;
}
