export function getFault(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const q = url.searchParams.get('fault');
  const header = req.headers['x-mock-fault'] || req.headers['X-Mock-Fault'];
  return (q || header || '').toString().trim().toLowerCase();
}

export function faultResponse(fault) {
  switch (fault) {
    case '401':
      return { status: 401, body: { error: { message: 'Fault injection: unauthorized' } } };
    case 'down':
      return { status: 503, body: { error: { message: 'Fault injection: service unavailable' } } };
    case 'toolarge':
      return { status: 413, body: { error: { message: 'Fault injection: payload too large' } } };
    case 'busy':
      return { status: 429, body: { error: { message: 'Fault injection: too many requests' } } };
    case 'timeout':
      return { kind: 'timeout' };
    case 'cut':
      return { kind: 'cut' };
    default:
      return null;
  }
}

export function parseCustomModelOptions(fault) {
  if (!fault.startsWith('modeloptions:')) return null;
  try {
    const json = fault.slice('modeloptions:'.length);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
