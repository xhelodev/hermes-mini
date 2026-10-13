import { HermesError } from '@/lib/hermes/errors';
import {
  mapJob,
  mapJobs,
  mapMessages,
  mapModelOptions,
  mapSession,
  mapSessions,
  mapSkills,
  mapToolsets,
  type ChatInput,
  type HermesJob,
  type HermesMessage,
  type HermesSession,
  type HermesSkill,
  type HermesToolset,
  type ModelSelection,
} from '@/lib/hermes/map';
import { pushSseChunk, type SseEvent } from '@/lib/hermes/sse';
import { joinUrl } from '@/lib/hermes/url';

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
      ? 'Ese archivo no tiene texto para leer.'
      : record.error;
  }
  if (typeof record?.message === 'string' && record.message.trim()) return record.message;
  return fallback;
}

function errorForStatus(status: number, body: unknown): HermesError {
  const message = errorMessage(body, `Error HTTP ${status}`);
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
    throw new HermesError(timedOut ? 'timeout' : 'aborted', timedOut ? 'Tiempo de espera agotado.' : 'Cancelado.');
  }
  throw new HermesError('down', 'No se pudo conectar con el servidor.');
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

  async createSession(title = 'Nueva conversación'): Promise<HermesSession> {
    try {
      return await this.insertSession(title);
    } catch (error) {
      if (error instanceof HermesError && error.status === 400) {
        const stamp = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        return this.insertSession(`${title} ${stamp}`);
      }
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const session = mapSession(payload);
    if (!session) {
      throw new HermesError('bad_response', 'El servidor no devolvió la conversación.');
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

  async listModelOptions(refresh = false): Promise<ModelSelection[]> {
    const path = refresh ? '/api/model/options?refresh=1' : '/api/model/options';
    const payload = await this.request(path);
    return mapModelOptions(payload);
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; pinned?: boolean },
  ): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: patch,
    });
    return this.requireSession(payload, 'El servidor no devolvió la conversación.');
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  async forkSession(sessionId: string, title: string): Promise<HermesSession> {
    const payload = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      body: { title },
    });
    return this.requireSession(payload, 'El servidor no devolvió la copia.');
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
  ): Promise<void> {
    const body: Record<string, unknown> = { input };
    if (model?.providerId && model.modelId) {
      body.provider = model.providerId;
      body.model = model.modelId;
    }
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`;
    if (isReactNative()) {
      await this.streamWithXhr(path, body, onEvent, signal);
      return;
    }
    await this.streamWithFetch(path, body, onEvent, signal);
  }

  private requireSession(payload: unknown, fallback: string): HermesSession {
    const session = mapSession(payload);
    if (!session) throw new HermesError('bad_response', fallback);
    return session;
  }

  private requireJob(payload: unknown): HermesJob {
    const job = mapJob(payload);
    if (!job) throw new HermesError('bad_response', 'El servidor no devolvió la tarea.');
    return job;
  }

  private async insertSession(title: string): Promise<HermesSession> {
    const payload = await this.request('/api/sessions', {
      method: 'POST',
      body: { title },
    });
    const session = mapSession(payload);
    if (!session) {
      throw new HermesError('bad_response', 'El servidor no devolvió la conversación nueva.');
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
    signal?: AbortSignal,
  ): Promise<void> {
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

    await readSseResponse(response, onEvent);
  }

  private streamWithXhr(
    path: string,
    body: Record<string, unknown>,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let seen = 0;
      let buffer = '';
      let settled = false;

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
      xhr.onprogress = consume;
      xhr.onload = () => {
        consume();
        if (xhr.status >= 200 && xhr.status < 300) {
          succeed();
          return;
        }
        fail(errorForStatus(xhr.status, parseJson(xhr.responseText)));
      };
      xhr.onerror = () => fail(new HermesError('down', 'No se pudo conectar con el servidor.'));
      xhr.onabort = () => fail(new HermesError('aborted', 'Cancelado.'));
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

async function readSseResponse(response: Response, onEvent: (event: SseEvent) => void): Promise<void> {
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
