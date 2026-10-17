import { HermesError } from '@/lib/hermes/errors';
import {
  BOT_CHAT_TITLE,
  mapCapabilities,
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
  type HermesCapabilities,
  type HermesJob,
  type HermesMessage,
  type HermesRun,
  type HermesSession,
  type HermesSkill,
  type HermesToolset,
  type ModelSelection,
} from '@/lib/hermes/map';
import { normalizeRunEvent, RUN_TERMINAL_EVENTS, runEventSeq } from '@/lib/hermes/run-events';
import { pushSseChunk, sseEventName, type SseEvent } from '@/lib/hermes/sse';
import { joinUrl } from '@/lib/hermes/url';
import { getLanguage, strings } from '@/lib/i18n';

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Un pedido que responde con SSE: el stream de sesión (POST) o los eventos de un turno (GET). */
type SseRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
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
  /**
   * Solo `runChat`: entrega una función que corta la conexión actual y la reabre desde el
   * último evento, sin cancelar el turno. Sirve al volver de segundo plano, cuando el socket
   * puede estar muerto sin que el sistema lo haya avisado.
   */
  onReconnectable?: (reconnect: () => void) => void;
};

/** Reintentos del POST de un turno; con la misma `Idempotency-Key` no se duplica. */
const SUBMIT_RETRIES = 2;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
/** Si el stream de un turno ya no existe, cada cuánto y hasta cuándo esperar su estado. */
const STATUS_POLL_MS = 3_000;
const STATUS_WAIT_MS = 10 * 60_000;

/** Un corte de red o un 5xx: vale la pena reintentar. */
function retryable(error: unknown): boolean {
  return error instanceof HermesError && (error.code === 'down' || error.code === 'timeout');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new HermesError('aborted', strings().errors.cancelled));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new HermesError('aborted', strings().errors.cancelled));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function idempotencyKey(): string {
  return `hm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

  /** Qué ofrece el servidor; `null` si no tiene `/v1/capabilities` (versiones viejas). */
  async getCapabilities(): Promise<HermesCapabilities | null> {
    try {
      return mapCapabilities(await this.request('/v1/capabilities'));
    } catch (error) {
      if (error instanceof HermesError && error.status === 404) return null;
      throw error;
    }
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

  /** Confirma que la clave sirve para este servidor o perfil: lista una conversación. */
  async checkAccess(): Promise<void> {
    await this.request('/api/sessions?limit=1');
  }

  /**
   * El chat permanente de un Bot: la conversación titulada exactamente "Bot Chat" de su
   * perfil, como `hermes peer dm`. Si no existe, la crea.
   */
  async openBotChat(): Promise<HermesSession> {
    const find = async () => {
      // `include_hidden` solo vale con `title`: la app de escritorio suele ocultar los Bot Chats.
      const query = new URLSearchParams({ title: BOT_CHAT_TITLE, include_hidden: '1', limit: '200' });
      const sessions = mapSessions(await this.request(`/api/sessions?${query.toString()}`));
      return sessions.find((session) => session.title.trim() === BOT_CHAT_TITLE) ?? null;
    };
    const existing = await find();
    if (existing) return existing;
    try {
      return await this.insertSession(BOT_CHAT_TITLE);
    } catch (error) {
      if (!(error instanceof HermesError && error.status === 400)) throw error;
      // El título es único: otro cliente lo creó recién, o un Hermes viejo lo tiene oculto.
      const created = await find();
      if (created) return created;
      throw new HermesError('conflict', strings().bots.hiddenChat, 400);
    }
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
    await this.openSse({ method: 'POST', path, body }, onEvent, signal, hooks);
  }

  /**
   * Un turno por `/v1/runs`. Hermes lo corre aparte de la conexión y guarda el turno en la
   * conversación, así que si el socket se corta (la app se minimizó, cambió la red) se retoma
   * desde el último evento recibido. Los eventos llegan traducidos al vocabulario de
   * `streamChat`. Solo texto: las imágenes siguen por `streamChat`.
   */
  async runChat(
    sessionId: string,
    text: string,
    model: Pick<ModelSelection, 'providerId' | 'modelId'> | null,
    onEvent: (event: SseEvent) => void,
    signal?: AbortSignal,
    hooks: StreamHooks = {},
  ): Promise<void> {
    const body: Record<string, unknown> = { input: text, session_id: sessionId };
    if (model?.providerId && model.modelId) {
      body.provider = model.providerId;
      body.model = model.modelId;
    }
    const runId = await this.submitRun(body, signal);
    hooks.onOpen?.();
    // Antes del primer evento, para que el chat ya pueda detener o corregir el turno.
    onEvent({ event: 'run.accepted', data: { run_id: runId } });
    await this.followRun(runId, onEvent, signal, hooks);
  }

  private async submitRun(body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    // La misma clave en cada intento: si el primero llegó y se perdió la respuesta, Hermes
    // devuelve ese turno en vez de empezar otro.
    const headers = { 'Idempotency-Key': idempotencyKey() };
    for (let attempt = 0; ; attempt += 1) {
      try {
        const payload = await this.request('/v1/runs', { method: 'POST', body, headers, signal });
        const runId = asRecord(payload)?.run_id;
        if (typeof runId !== 'string' || !runId) {
          throw new HermesError('bad_response', strings().errors.missingRun);
        }
        return runId;
      } catch (error) {
        if (!retryable(error) || attempt >= SUBMIT_RETRIES) throw error;
        await wait(RECONNECT_BASE_MS * 2 ** attempt, signal);
      }
    }
  }

  /** Sigue los eventos de un turno hasta el final, reconectando desde el último recibido. */
  private async followRun(
    runId: string,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
    hooks: StreamHooks,
  ): Promise<void> {
    const path = `/v1/runs/${encodeURIComponent(runId)}/events`;
    let lastSeq: number | null = null;
    let finished = false;
    let failures = 0;
    let connection: AbortController | null = null;
    // Corta la espera entre reintentos cuando se pide reconectar.
    let nudge: (() => void) | null = null;
    hooks.onReconnectable?.(() => {
      connection?.abort();
      nudge?.();
    });

    const handle = (event: SseEvent) => {
      const seq = runEventSeq(event);
      if (seq !== null) {
        // Al reconectar, Hermes reenvía desde Last-Event-ID; por las dudas no repetimos.
        if (lastSeq !== null && seq <= lastSeq) return;
        lastSeq = seq;
      }
      failures = 0;
      if (RUN_TERMINAL_EVENTS.has(sseEventName(event))) finished = true;
      normalizeRunEvent(event).forEach(onEvent);
    };

    while (!finished) {
      const current = new AbortController();
      connection = current;
      const onAbort = () => current.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) current.abort();
      const headers: Record<string, string> = lastSeq === null ? {} : { 'Last-Event-ID': String(lastSeq) };
      try {
        await this.openSse({ method: 'GET', path, headers }, handle, current.signal, { onData: hooks.onData });
        if (finished) return;
        // Se cerró sin el evento final: reconectamos.
      } catch (error) {
        if (signal?.aborted) throw new HermesError('aborted', strings().errors.cancelled);
        if (current.signal.aborted) continue; // reconexión pedida: sin espera
        if (error instanceof HermesError && error.status === 404) {
          // Hermes ya no guarda el stream (el turno terminó hace rato, o pasaron 5 minutos
          // sin nadie conectado): queda su estado.
          await this.finishFromStatus(runId, onEvent, signal);
          return;
        }
        if (!retryable(error)) throw error;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      failures += 1;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(failures - 1, 4));
      await new Promise<void>((resolve, reject) => {
        nudge = resolve;
        wait(delay, signal).then(resolve, reject);
      }).finally(() => {
        nudge = null;
      });
    }
  }

  /** Espera a que el turno termine y emite su final como si hubiera llegado por el stream. */
  private async finishFromStatus(
    runId: string,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const deadline = Date.now() + STATUS_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const status = asRecord(await this.request(`/v1/runs/${encodeURIComponent(runId)}`, { signal }));
        const run = mapRun(status);
        if (status && run?.finished) {
          normalizeRunEvent({ event: null, data: { ...status, event: `run.${run.status}` } }).forEach(onEvent);
          return;
        }
      } catch (error) {
        // Sin estado (venció o el servidor se reinició): lo guardado en la conversación es lo que hay.
        if (error instanceof HermesError && error.status === 404) return;
        if (!retryable(error)) throw error;
      }
      await wait(STATUS_POLL_MS, signal);
    }
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
      const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
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

  private openSse(
    request: SseRequest,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
    hooks: StreamHooks,
  ): Promise<void> {
    if (isReactNative()) return this.streamWithXhr(request, onEvent, signal, hooks);
    return this.streamWithFetch(request, onEvent, signal, hooks);
  }

  private async streamWithFetch(
    request: SseRequest,
    onEvent: (event: SseEvent) => void,
    signal: AbortSignal | undefined,
    hooks: StreamHooks,
  ): Promise<void> {
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(joinUrl(this.baseUrl, request.path), {
          method: request.method,
          headers: this.streamHeaders(request),
          body: request.body ? JSON.stringify(request.body) : undefined,
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
    request: SseRequest,
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

      xhr.open(request.method, joinUrl(this.baseUrl, request.path));
      const headers = this.streamHeaders(request);
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
      xhr.send(request.body ? JSON.stringify(request.body) : null);
    });
  }

  private streamHeaders(request: SseRequest): Record<string, string> {
    return {
      Accept: 'text/event-stream',
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${this.apiKey}`,
      ...request.headers,
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
