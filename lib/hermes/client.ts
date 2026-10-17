import { HermesError } from '@/lib/hermes/errors';
import {
  mapJob,
  mapJobs,
  mapMessages,
  mapModelOptions,
  mapRun,
  mapSession,
  mapSessions,
  mapSkills,
  mapToolsets,
  type ChatInput,
  type HermesJob,
  type HermesMessage,
  type HermesRun,
  type HermesSession,
  type HermesSkill,
  type HermesToolset,
  type ModelSelection,
} from '@/lib/hermes/map';
import { pushSseChunk, type SseEvent } from '@/lib/hermes/sse';
import { joinUrl } from '@/lib/hermes/url';
import { getLanguage, strings } from '@/lib/i18n';

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type HermesClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/** Señales del transporte para mostrar en qué va un turno, aparte de sus eventos. */
export type StreamHooks = {
  /** Fracción (0–1) del pedido ya enviado. Solo en React Native, donde se usa XHR. */
  onUploadProgress?: (fraction: number) => void;
  /** El servidor aceptó el pedido y el stream quedó abierto. */
  onOpen?: () => void;
  /** Llegaron bytes, incluidos los comentarios `: keepalive`. */
  onData?: () => void;
};

function isReactNative(): boolean {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function errorMessage(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const nested = asRecord(record?.error);
  if (typeof nested?.message === 'string' && nested.message.trim()) return nested.message;
  if (typeof record?.error === 'string' && record.error.trim()) {
    return record.error === 'no_text'
      ? strings().errors.noText
      : record.error;
  }
  if (typeof record?.message === 'string' && record.message.trim()) return record.message;
  return fallback;
}

function errorForStatus(status: number, body: unknown): HermesError {
  const message = errorMessage(body, strings().errors.http(status));
  if (status === 401 || status === 403) return new HermesError('unauthorized', message, status);
  if (status === 404) return new HermesError('not_found', message, status);
  if (status === 408) return new HermesError('timeout', message, status);
  if (status === 409) return new HermesError('conflict', message, status);
  if (status === 501) return new HermesError('unavailable', message, status);
  if (status === 429) return new HermesError('rate_limit', message, status);
  if (status >= 500) return new HermesError('down', message, status);
  return new HermesError('bad_response', message, status);
}

function throwIfAborted(error: unknown, timedOut: boolean): never {
  if (error instanceof HermesError) throw error;
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') {
    throw new HermesError(timedOut ? 'timeout' : 'aborted', timedOut ? strings().errors.timedOut : strings().errors.cancelled);
  }
  throw new HermesError('down', strings().errors.down);
}

export class HermesClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HermesClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async probe(): Promise<{ latencyMs: number }> {
    const started = Date.now();
    await this.request('/health', { auth: false });
    try {
      await this.request('/health/detailed');
    } catch (error) {
      if (error instanceof HermesError && error.status === 404) {
        await this.request('/v1/models');
      } else {
        throw error;
      }
    }
    return { latencyMs: Date.now() - started };
  }

  async listSessions(): Promise<HermesSession[]> {
    const collected: HermesSession[] = [];
    const limit = 50;
    let offset = 0;

    for (let page = 0; page < 4; page += 1) {
      const payload = await this.request(`/api/sessions?limit=${limit}&offset=${offset}`);
      const record = asRecord(payload);
      const batch = mapSessions(payload);
      collected.push(...batch);
      const rawCount = Array.isArray(record?.data) ? record.data.length : batch.length;
      const hasMore = record?.has_more === true;
      if (!hasMore || rawCount < limit) break;
      offset += limit;
    }

    const byId = new Map<string, HermesSession>();
    for (const session of collected) byId.set(session.id, session);
    return [...byId.values()].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }

  async createSession(title = strings().sessions.newTitle): Promise<HermesSession> {
    try {
      return await this.insertSession(title);
    } catch (error) {
      if (!(error instanceof HermesError && error.status === 400)) throw error;
    }

    // El servidor exige títulos únicos: reintenta con hora (con segundos) y, si
    // sigue chocando, con un sufijo aleatorio.
    const stamp = new Date().toLocaleTimeString(getLanguage(), {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    try {
      return await this.insertSession(`${title} ${stamp}`);
    } catch (error) {
      if (!(error instanceof HermesError && error.status === 400)) throw error;
    }
    const suffix = Math.random().toString(36).slice(2, 6);
    return this.insertSession(`${title} ${stamp} ${suffix}`);
  }

  async getSession(sessionId: string): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const session = mapSession(payload);
    if (!session) {
      throw new HermesError('bad_response', strings().errors.missingSession);
    }
    return session;
  }

  async getMessages(sessionId: string): Promise<HermesMessage[]> {
    const query = new URLSearchParams({
      inline_images: 'true',
      include_compacted: 'true',
      order: 'oldest',
      limit: '500',
    });
    const payload = await this.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`,
    );
    return mapMessages(payload);
  }

  async getLastMessage(sessionId: string): Promise<HermesMessage | null> {
    // Hermes solo acepta `oldest` o `latest`; `latest` pagina desde el final.
    const query = new URLSearchParams({ order: 'latest', limit: '1' });
    const payload = await this.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`,
    );
    return mapMessages(payload)[0] ?? null;
  }

  async listModelOptions(refresh = false): Promise<ModelSelection[]> {
    const path = refresh ? '/api/model/options?refresh=1' : '/api/model/options';
    const payload = await this.request(path);
    return mapModelOptions(payload);
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: patch,
    });
    return this.requireSession(payload, strings().errors.missingSession);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  async forkSession(sessionId: string, title: string): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      body: { title },
    });
    return this.requireSession(payload, strings().errors.missingCopy);
  }

  async lockSessionModel(
    sessionId: string,
    model: Pick<ModelSelection, 'providerId' | 'modelId'>,
  ): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      body: { provider: model.providerId, model: model.modelId },
    });
  }

  async getRun(runId: string): Promise<HermesRun> {
    const run = mapRun(await this.request(`/v1/runs/${encodeURIComponent(runId)}`));
    if (!run) throw new HermesError('bad_response', strings().errors.missingRun);
    return run;
  }

  /** Le pasa una corrección al turno en curso; el agente la lee al terminar lo que está haciendo. */
  async steerRun(runId: string, text: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: 'POST',
      body: { input: text },
    });
  }

  async stopRun(runId: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
  }

  async approveRun(runId: string, choice: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      body: { choice },
    });
  }

  async listSkills(): Promise<HermesSkill[]> {
    return mapSkills(await this.request('/v1/skills'));
  }

  async listToolsets(): Promise<HermesToolset[]> {
    return mapToolsets(await this.request('/v1/toolsets'));
  }

  async listJobs(): Promise<HermesJob[]> {
    return mapJobs(await this.request('/api/jobs?include_disabled=true'));
  }

  async getJob(jobId: string): Promise<HermesJob> {
    return this.requireJob(await this.request(`/api/jobs/${encodeURIComponent(jobId)}`));
  }

  async patchJob(
    jobId: string,
    input: { name?: string; schedule?: string; prompt?: string },
  ): Promise<HermesJob> {
    return this.requireJob(
      await this.request(`/api/jobs/${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        body: input,
      }),
    );
  }

  async createJob(input: { name: string; schedule: string; prompt: string }): Promise<HermesJob> {
    const payload = await this.request('/api/jobs', {
      method: 'POST',
      body: { name: input.name, schedule: input.schedule, prompt: input.prompt, deliver: 'local' },
    });
    return this.requireJob(payload);
  }

  async pauseJob(jobId: string): Promise<HermesJob> {
    return this.requireJob(
      await this.request(`/api/jobs/${encodeURIComponent(jobId)}/pause`, { method: 'POST' }),
    );
  }

  async resumeJob(jobId: string): Promise<HermesJob> {
    return this.requireJob(
      await this.request(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST' }),
    );
  }

  async runJob(jobId: string): Promise<HermesJob> {
    return this.requireJob(
      await this.request(`/api/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST' }),
    );
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  }

  async streamChat(
    sessionId: string,
    input: ChatInput,
    model: Pick<ModelSelection, 'providerId' | 'modelId'> | null,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
    hooks: StreamHooks = {},
  ): Promise<void> {
    const body: Record<string, unknown> = { input };
    if (model?.providerId && model.modelId) {
      body.provider = model.providerId;
      body.model = model.modelId;
    }
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`;
    if (isReactNative()) {
      await this.streamWithXhr(path, body, onEvent, signal, hooks);
      return;
    }
    await this.streamWithFetch(path, body, onEvent, signal, hooks);
  }

  private requireSession(payload: unknown, fallback: string): HermesSession {
    const session = mapSession(payload);
    if (!session) throw new HermesError('bad_response', fallback);
    return session;
  }

  private requireJob(payload: unknown): HermesJob {
    const job = mapJob(payload);
    if (!job) throw new HermesError('bad_response', strings().errors.missingJob);
    return job;
  }

  private async insertSession(title: string): Promise<HermesSession> {
    const payload = await this.request('/api/sessions', {
      method: 'POST',
      body: { title },
    });
    const session = mapSession(payload);
    if (!session) {
      throw new HermesError('bad_response', strings().errors.missingNewSession);
    }
    return session;
  }

  private async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    const timeout = this.linkTimeout(options.timeoutMs ?? this.timeoutMs, options.signal);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.auth !== false && this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let response: Response;
      try {
        response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
          method: options.method ?? 'GET',
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: timeout.signal,
        });
      } catch (error) {
        throwIfAborted(error, timeout.timedOut());
      }

      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) {
        throw errorForStatus(response.status, parsed);
      }
      return parsed;
    } finally {
      timeout.cancel();
    }
  }

  private async streamWithFetch(
    path: string,
    body: Record<string, unknown>,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
    hooks: StreamHooks,
  ): Promise<void> {
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
          method: 'POST',
          headers: this.streamHeaders(),
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        throwIfAborted(error, false);
      }

      if (!response.ok) {
        const text = await response.text();
        throw errorForStatus(response.status, parseJson(text));
      }

      hooks.onOpen?.();
      await readSseResponse(response, onEvent, hooks.onData);
    } catch (error) {
      if (signal?.aborted) throw new HermesError('aborted', strings().errors.cancelled);
      throw error;
    }
  }

  private streamWithXhr(
    path: string,
    body: Record<string, unknown>,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
    hooks: StreamHooks,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let seen = 0;
      let buffer = '';
      let settled = false;
      let opened = false;

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const consume = () => {
        const next = xhr.responseText.slice(seen);
        seen = xhr.responseText.length;
        if (!next) return;
        const parsed = pushSseChunk(buffer, next);
        buffer = parsed.buffer;
        parsed.events.forEach(onEvent);
      };

      xhr.open('POST', joinUrl(this.baseUrl, path));
      const headers = this.streamHeaders();
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) hooks.onUploadProgress?.(event.loaded / event.total);
      };
      xhr.onreadystatechange = () => {
        if (opened || xhr.readyState < xhr.HEADERS_RECEIVED) return;
        if (xhr.status < 200 || xhr.status >= 300) return;
        opened = true;
        hooks.onOpen?.();
      };
      xhr.onprogress = () => {
        hooks.onData?.();
        consume();
      };
      xhr.onload = () => {
        consume();
        if (xhr.status >= 200 && xhr.status < 300) {
          succeed();
          return;
        }
        fail(errorForStatus(xhr.status, parseJson(xhr.responseText)));
      };
      xhr.onerror = () => fail(new HermesError('down', strings().errors.down));
      xhr.onabort = () => fail(new HermesError('aborted', strings().errors.cancelled));
      if (signal) {
        if (signal.aborted) {
          xhr.abort();
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }
      xhr.send(JSON.stringify(body));
    });
  }

  private streamHeaders(): Record<string, string> {
    return {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private linkTimeout(ms: number, parent?: AbortSignal): {
    signal: AbortSignal;
    cancel: () => void;
    timedOut: () => boolean;
  } {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    const onParent = () => controller.abort();
    parent?.addEventListener('abort', onParent);
    if (parent?.aborted) controller.abort();
    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      cancel() {
        clearTimeout(timer);
        parent?.removeEventListener('abort', onParent);
      },
    };
  }
}

async function readSseResponse(
  response: Response,
  onEvent: (event: SseEvent) => void,
  onData?: () => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    const parsed = pushSseChunk('', await response.text());
    parsed.events.forEach(onEvent);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onData?.();
    const parsed = pushSseChunk(buffer, decoder.decode(value, { stream: true }));
    buffer = parsed.buffer;
    parsed.events.forEach(onEvent);
  }
  const tail = pushSseChunk(buffer, decoder.decode());
  tail.events.forEach(onEvent);
}

function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}
