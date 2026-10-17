import { currentProfile, profileKey } from './profile-scope.mjs';

export function parseBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function requireAuth(req, { allowUnauthenticated = false } = {}) {
  if (allowUnauthenticated) return null;
  const token = parseBearer(req.headers.authorization || req.headers.Authorization);
  // Como Hermes: bajo /p/<perfil>/ vale la clave de ese perfil, no la del principal.
  if (!token || token !== profileKey(currentProfile())) {
    return { status: 401, body: { error: { message: 'Invalid API key', type: 'invalid_api_key' } } };
  }
  return null;
}
