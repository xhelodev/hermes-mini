import { sseEventName, type SseEvent } from '@/lib/hermes/sse';

/** Eventos con los que termina un turno de `/v1/runs`. */
export const RUN_TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);

function named(name: string, data: Record<string, unknown>): SseEvent {
  return { event: name, data };
}

/**
 * Traduce un evento de `/v1/runs/{id}/events` al vocabulario del stream de sesión, que es el
 * que entiende el chat. Lo que no tiene equivalente pasa tal cual (el chat lo ignora).
 */
export function normalizeRunEvent(event: SseEvent): SseEvent[] {
  const name = sseEventName(event);
  const data = event.data;
  switch (name) {
    case 'message.delta':
      return [named('assistant.delta', data)];
    case 'message.interim':
      return [named('assistant.commentary', data)];
    case 'tool.started':
      return [named('tool.started', { ...data, tool_name: data.tool })];
    case 'tool.completed':
      return [named(data.error === true ? 'tool.failed' : 'tool.completed', { ...data, tool_name: data.tool })];
    case 'run.completed': {
      // La respuesta final viene en `output`, no en `assistant.completed` ni en `messages`.
      const output = typeof data.output === 'string' ? data.output : '';
      const final = output ? [named('assistant.completed', { ...data, content: output })] : [];
      return [...final, named('run.completed', data)];
    }
    case 'run.interrupted':
      return [named('run.cancelled', data)];
    default:
      return [named(name, data)];
  }
}

/** El número de un evento, para pedir lo que sigue con `Last-Event-ID`. */
export function runEventSeq(event: SseEvent): number | null {
  const seq = event.data.seq;
  if (typeof seq === 'number' && Number.isInteger(seq)) return seq;
  const id = Number.parseInt(event.id ?? '', 10);
  return Number.isNaN(id) ? null : id;
}
