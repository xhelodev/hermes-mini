export type SseEvent = {
  event: string | null;
  data: Record<string, unknown>;
  /** Línea `id:`; `/v1/runs/{id}/events` numera así cada evento para retomar desde ahí. */
  id?: string | null;
};

/** El stream de sesión lo manda en `event:`; `/v1/runs` lo pone dentro de `data.event`. */
export function sseEventName(event: SseEvent): string {
  if (event.event) return event.event;
  const name = event.data.type ?? event.data.event;
  return typeof name === 'string' ? name : '';
}

/** Acumula un chunk SSE y devuelve los eventos completos. Ignora comentarios `: keepalive`. */
export function pushSseChunk(buffer: string, chunk: string): { buffer: string; events: SseEvent[] } {
  const combined = buffer + chunk;
  const parts = combined.split(/\n\n/);
  const rest = parts.pop() ?? '';
  const events: SseEvent[] = [];
  for (const part of parts) {
    const event = parseSseBlock(part);
    if (event) events.push(event);
  }
  return { buffer: rest, events };
}

function parseSseBlock(block: string): SseEvent | null {
  let eventName: string | null = null;
  let id: string | null = null;
  const dataLines: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('id:')) {
      id = line.slice('id:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }

  if (dataLines.length === 0) return null;
  const raw = dataLines.join('\n');
  if (raw === '[DONE]') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { event: eventName, data: parsed as Record<string, unknown>, id };
    }
    return { event: eventName, data: { value: parsed }, id };
  } catch {
    return { event: eventName, data: { raw }, id };
  }
}
