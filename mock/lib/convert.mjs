import Busboy from 'busboy';
import { MOCK_API_KEY, CONVERT_FIXTURES, CONVERT_SUPPORTED_EXT, MAX_CONVERT_BODY_BYTES } from './constants.mjs';
import { parseBearer } from './auth.mjs';
import { getFault } from './faults.mjs';
import { sendJson } from './http.mjs';

function extFromFilename(name) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function extFromMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('wordprocessingml') || m === 'application/msword') return 'docx';
  if (m.includes('spreadsheetml')) return 'xlsx';
  if (m.includes('presentationml')) return 'pptx';
  if (m.startsWith('text/')) return 'txt';
  if (m.startsWith('video/')) return 'video';
  return '';
}

function convertFault(fault) {
  if (fault === 'timeout') return { kind: 'timeout' };
  if (fault === 'down-close' || fault === 'down:close') return { kind: 'close' };
  if (fault === 'down') {
    return { status: 503, body: { error: { message: 'Document converter unavailable (fault injection)' } } };
  }
  return null;
}

function unauthorized(res, reason) {
  return sendJson(res, 401, {
    error: { message: reason, type: 'invalid_api_key' },
  });
}

export async function handleConvert(req, res) {
  const token = parseBearer(req.headers.authorization || req.headers.Authorization);
  if (!token) {
    return unauthorized(res, 'Missing Bearer token. Use Authorization: Bearer mock-test-key');
  }
  if (token !== MOCK_API_KEY) {
    return unauthorized(res, 'Invalid API key');
  }

  const fault = getFault(req);
  const injected = convertFault(fault);
  if (injected?.status) return sendJson(res, injected.status, injected.body);
  if (injected?.kind === 'timeout') {
    await new Promise(() => {});
    return;
  }
  if (injected?.kind === 'close') {
    res.destroy();
    return;
  }

  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_CONVERT_BODY_BYTES) {
    return sendJson(res, 413, { error: { message: 'File too large (maximum 25 MB)' } });
  }

  return new Promise((resolve) => {
    let total = 0;
    let filename = '';
    let mime = '';
    let gotFile = false;

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_CONVERT_BODY_BYTES, files: 1 },
    });

    bb.on('file', (_fieldname, stream, info) => {
      gotFile = true;
      filename = info.filename || '';
      mime = info.mimeType || '';
      stream.on('data', (d) => {
        total += d.length;
        if (total > MAX_CONVERT_BODY_BYTES) {
          stream.destroy();
          bb.destroy();
          sendJson(res, 413, { error: { message: 'File too large (maximum 25 MB)' } });
          resolve();
        }
      });
      stream.on('error', () => {});
      stream.resume();
    });

    bb.on('error', () => {
      if (!res.writableEnded) sendJson(res, 400, { error: { message: 'Invalid multipart body' } });
      resolve();
    });

    bb.on('finish', () => {
      if (res.writableEnded) return resolve();
      if (!gotFile) {
        sendJson(res, 400, { error: { message: 'Missing file field in multipart form' } });
        return resolve();
      }

      const ext = extFromFilename(filename) || extFromMime(mime);

      if (ext === 'video' || mime.startsWith('video/')) {
        sendJson(res, 415, {
          error: {
            message: `Unsupported media type for conversion: ${mime || 'video/*'}`,
            code: 'unsupported_media_type',
          },
        });
        return resolve();
      }

      if (!CONVERT_SUPPORTED_EXT.has(ext)) {
        const hint = ext ? `extension .${ext}` : mime || 'unknown type';
        sendJson(res, 415, {
          error: {
            message: `Unsupported file type (${hint}). Supported: pdf, docx, xlsx, pptx, txt`,
            code: 'unsupported_media_type',
          },
        });
        return resolve();
      }

      if (fault === 'scanned' && ext === 'pdf') {
        sendJson(res, 422, { error: 'no_text' });
        return resolve();
      }

      sendJson(res, 200, { markdown: CONVERT_FIXTURES[ext] });
      resolve();
    });

    req.pipe(bb);
  });
}
