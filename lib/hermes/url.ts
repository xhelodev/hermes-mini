import { HermesError } from '@/lib/hermes/errors';

/** Base del API server, sin el sufijo `/v1` que agregan los clientes OpenAI. */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new HermesError('bad_response', 'Ingresá la URL del servidor.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new HermesError('bad_response', 'La URL no es válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HermesError('bad_response', 'La URL no es válida.');
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

export function joinUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${suffix}`;
}
