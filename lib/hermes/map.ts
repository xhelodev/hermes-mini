export type HermesSession = {
  id: string;
  title: string;
  source: string | null;
  preview: string;
  updatedAt: number | null;
  pinned: boolean;
  archived: boolean;
  endReason: string | null;
};

export type HermesSkill = {
  name: string;
  description: string;
  category: string | null;
};

export type HermesToolset = {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
};

export type HermesJob = {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  state: string;
  paused: boolean;
  deliver: string;
};

export type HermesAttachment = {
  kind: 'image';
  label: string;
  url: string | null;
};

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ChatInput = string | ChatContentPart[];

export type HermesMessage = {
  id: string;
  role: string;
  text: string;
  reasoning: string;
  toolName: string | null;
  attachments: HermesAttachment[];
};

export type ModelSelection = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  label: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.sessions)) return record.sessions;
  if (Array.isArray(record.messages)) return record.messages;
  return [];
}

export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /^\d+(\.\d+)?$/.test(value.trim())) {
      return parseTimestamp(numeric);
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function imagePartUrl(record: Record<string, unknown>): string | null {
  const direct = record.image_url;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const nested = asRecord(direct);
  const nestedUrl = nested ? stringField(nested, 'url') : null;
  if (nestedUrl) return nestedUrl;
  return stringField(record, 'url');
}

export function messageAttachments(content: unknown): HermesAttachment[] {
  if (!Array.isArray(content)) return [];
  const attachments: HermesAttachment[] = [];
  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    if (record.type === 'image_url' || record.type === 'input_image' || record.image_url) {
      attachments.push({ kind: 'image', label: 'Imagen', url: imagePartUrl(record) });
    }
  }
  return attachments;
}

function isImagePart(record: Record<string, unknown>): boolean {
  return record.type === 'image_url' || record.type === 'input_image' || Boolean(record.image_url);
}

function isTextPart(record: Record<string, unknown>): boolean {
  if (isImagePart(record)) return false;
  const type = record.type;
  return typeof type !== 'string' || !type.trim() || type === 'text' || type === 'input_text';
}

function partBody(record: Record<string, unknown>): string {
  if (typeof record.text === 'string') return record.text;
  if (typeof record.reasoning === 'string') return record.reasoning;
  if (typeof record.content === 'string') return record.content;
  return '';
}

function pushChunk(chunks: string[], value: string) {
  const trimmed = value.trim();
  if (!trimmed || chunks.includes(trimmed)) return;
  chunks.push(trimmed);
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        if (!record) return '';
        if (isImagePart(record)) return '[imagen]';
        if (!isTextPart(record)) return '';
        return typeof record.text === 'string' ? record.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  const record = asRecord(content);
  if (record && isTextPart(record) && typeof record.text === 'string') return record.text;
  return '';
}

export function messageReasoning(content: unknown, record?: Record<string, unknown> | null): string {
  const chunks: string[] = [];
  if (record) {
    const direct = stringField(record, 'reasoning') || stringField(record, 'reasoning_content');
    if (direct) pushChunk(chunks, direct);
  }
  if (Array.isArray(content)) {
    for (const part of content) {
      const partRecord = asRecord(part);
      if (!partRecord || isImagePart(partRecord) || isTextPart(partRecord)) continue;
      pushChunk(chunks, partBody(partRecord));
    }
  } else {
    const single = asRecord(content);
    if (single && !isImagePart(single) && !isTextPart(single)) pushChunk(chunks, partBody(single));
  }
  return chunks.join('\n\n');
}

function previewFromMessages(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  const last = value[value.length - 1];
  const record = asRecord(last);
  if (!record) return '';
  return messageText(record.content);
}

function sessionRecord(raw: unknown): Record<string, unknown> | null {
  const row = asRecord(raw);
  if (!row) return null;
  if (stringField(row, 'id') || stringField(row, 'session_id')) return row;
  return asRecord(row.session);
}

export function mapSession(raw: unknown): HermesSession | null {
  const record = sessionRecord(raw);
  if (!record) return null;
  const id = stringField(record, 'id') || stringField(record, 'session_id');
  if (!id) return null;
  return {
    id,
    title: stringField(record, 'title') || 'Sin título',
    source: stringField(record, 'source'),
    preview: stringField(record, 'preview') || previewFromMessages(record.messages),
    updatedAt: parseTimestamp(
      record.last_active ?? record.updated_at ?? record.started_at ?? record.created_at,
    ),
    pinned: record.pinned === true,
    archived: record.archived === true,
    endReason: stringField(record, 'end_reason'),
  };
}

export function mapSessions(payload: unknown): HermesSession[] {
  return unwrapList(payload)
    .map((row) => mapSession(row))
    .filter(
      (session): session is HermesSession =>
        session !== null && !session.archived && session.endReason !== 'branched',
    )
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
}

export function mapMessages(payload: unknown): HermesMessage[] {
  return unwrapList(payload).flatMap((row, index) => {
    const record = asRecord(row);
    if (!record) return [];
    const role = (stringField(record, 'role') || 'other').toLowerCase();
    return [
      {
        id: stringField(record, 'id') || `msg-${index}`,
        role,
        text: messageText(record.content),
        reasoning: messageReasoning(record.content, record),
        toolName: stringField(record, 'tool_name') || stringField(record, 'tool'),
        attachments: messageAttachments(record.content),
      },
    ];
  });
}

function modelIdOf(model: unknown): { modelId: string; label: string } | null {
  if (typeof model === 'string' && model.trim()) {
    return { modelId: model.trim(), label: model.trim() };
  }
  const record = asRecord(model);
  if (!record) return null;
  const modelId =
    stringField(record, 'id') || stringField(record, 'name') || stringField(record, 'slug');
  if (!modelId) return null;
  const label = stringField(record, 'label') || stringField(record, 'name') || modelId;
  return { modelId, label };
}

export function mapModelOptions(payload: unknown): ModelSelection[] {
  const root = asRecord(payload);
  const nested = asRecord(root?.data);
  const providers = Array.isArray(root?.providers)
    ? root.providers
    : Array.isArray(nested?.providers)
      ? nested.providers
      : [];

  const options: ModelSelection[] = [];
  for (const provider of providers) {
    const record = asRecord(provider);
    if (!record) continue;
    const providerId =
      stringField(record, 'id') || stringField(record, 'slug') || stringField(record, 'name');
    if (!providerId) continue;
    const providerLabel = stringField(record, 'label') || stringField(record, 'name') || providerId;
    const models = Array.isArray(record.models) ? record.models : [];
    for (const model of models) {
      const parsed = modelIdOf(model);
      if (!parsed) continue;
      options.push({
        providerId,
        providerLabel,
        modelId: parsed.modelId,
        label: parsed.label,
      });
    }
  }
  return options;
}

function scheduleText(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  return stringField(record, 'expr') || stringField(record, 'display') || '';
}

export function mapSkills(payload: unknown): HermesSkill[] {
  return unwrapList(payload).flatMap((row) => {
    const record = asRecord(row);
    if (!record) return [];
    const name = stringField(record, 'name') || stringField(record, 'id');
    if (!name) return [];
    return [
      {
        name,
        description: stringField(record, 'description') || '',
        category: stringField(record, 'category'),
      },
    ];
  });
}

export function mapToolsets(payload: unknown): HermesToolset[] {
  return unwrapList(payload).flatMap((row) => {
    const record = asRecord(row);
    if (!record) return [];
    const name = stringField(record, 'name');
    if (!name) return [];
    return [
      {
        name,
        label: stringField(record, 'label') || name,
        description: stringField(record, 'description') || '',
        enabled: record.enabled === true,
      },
    ];
  });
}

export function mapJob(raw: unknown): HermesJob | null {
  const row = asRecord(raw);
  const record = asRecord(row?.job) ?? row;
  if (!record) return null;
  const id = stringField(record, 'id');
  if (!id) return null;
  const state = stringField(record, 'state') || (record.enabled === false ? 'paused' : 'scheduled');
  return {
    id,
    name: stringField(record, 'name') || 'Sin nombre',
    prompt: stringField(record, 'prompt') || '',
    schedule: scheduleText(record.schedule),
    state,
    paused: state === 'paused' || record.enabled === false,
    deliver: stringField(record, 'deliver') || 'local',
  };
}

export function mapJobs(payload: unknown): HermesJob[] {
  const record = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.jobs)
      ? record.jobs
      : unwrapList(payload);
  return list.flatMap((row) => {
    const job = mapJob(row);
    return job ? [job] : [];
  });
}

export function formatPreview(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

const SOURCE_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  api_server: 'API',
  cli: 'CLI',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
};

export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  return SOURCE_LABELS[source] ?? source;
}

export function formatSessionTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  const current = new Date(now);
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  if (sameDay) {
    return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Ayer';
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
