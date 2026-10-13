const UNSUPPORTED = 'unsupported_content_type';

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

function isDataUrl(s) {
  return typeof s === 'string' && s.startsWith('data:');
}

function dataUrlIsImage(url) {
  const m = url.match(/^data:([^;,]+)/i);
  if (!m) return false;
  return m[1].toLowerCase().startsWith('image/');
}

function partType(part) {
  if (!part || typeof part !== 'object') return null;
  if (part.type === 'image_url' || part.image_url) return 'image_url';
  if (part.type === 'file' || part.file) return 'file';
  if (part.type === 'input_file' || part.input_file) return 'input_file';
  return part.type || null;
}

function validateImageUrlPart(part) {
  const url = part.image_url?.url ?? part.url;
  if (!url) return UNSUPPORTED;
  if (isHttpUrl(url)) return null;
  if (isDataUrl(url)) {
    return dataUrlIsImage(url) ? null : UNSUPPORTED;
  }
  return UNSUPPORTED;
}

export function validateMessageContent(content) {
  if (content == null) return null;
  if (typeof content === 'string') return null;
  if (!Array.isArray(content)) return null;

  for (const part of content) {
    const t = partType(part);
    if (t === 'file' || t === 'input_file') return UNSUPPORTED;
    if (t === 'image_url') {
      const err = validateImageUrlPart(part);
      if (err) return err;
      continue;
    }
    if (t && t !== 'text') {
      const url = part.url || part.image_url?.url;
      if (isDataUrl(url) && !dataUrlIsImage(url)) return UNSUPPORTED;
    }
  }
  return null;
}

export function validateMessages(messages) {
  if (!Array.isArray(messages)) return null;
  for (const msg of messages) {
    const err = validateMessageContent(msg?.content);
    if (err) return err;
  }
  return null;
}
