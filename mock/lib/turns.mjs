import { appendMessage } from './store.mjs';

const STEER_OPEN =
  '[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; ' +
  'not tool output and not a new delivery when replayed from conversation history]';
const STEER_CLOSE = '[/OUT-OF-BAND USER MESSAGE]';
const SLOW_FILLER =
  'Este turno avanza despacio para probar las correcciones: mandá una antes de la mitad y ' +
  'el agente la lee a mitad de camino; mandala después y vuelve como pending_steer al terminar.';
// Los tests lo bajan para no esperar segundos.
const slowWordMs = () => Number(process.env.MOCK_SLOW_WORD_MS) || 400;

/**
 * Escribe la respuesta de un turno lento palabra por palabra (fault `slowstream`), como
 * Hermes: las correcciones que llegan antes de la mitad se entregan (quedan como fila `steer`
 * en el historial) y las que llegan después vuelven en `pending_steer`. `stopped()` corta el
 * turno; lo escrito hasta ahí queda guardado.
 *
 * @returns {Promise<{ reply: string, late: string, cancelled: boolean }>}
 */
export async function playSlowTurn({ run, sessionId, text, emitDelta, stopped }) {
  run.steers ??= [];
  // Largo a propósito: unas 30 palabras dan tiempo de mandar una corrección desde el teléfono.
  const words = `${text}\n\n${SLOW_FILLER}`.split(/(?<= )/);
  const checkpoint = Math.ceil(words.length / 2);
  let reply = '';
  let delivered = 0;
  for (const [index, word] of words.entries()) {
    if (stopped()) {
      if (reply && sessionId) appendMessage(sessionId, { role: 'assistant', content: reply });
      return { reply, late: '', cancelled: true };
    }
    if (index === checkpoint && run.steers.length > 0) {
      const steer = run.steers.join('\n');
      delivered = run.steers.length;
      if (sessionId) {
        appendMessage(sessionId, {
          role: 'user',
          content: `${STEER_OPEN}\n${steer}\n${STEER_CLOSE}`,
          display_kind: 'steer',
        });
      }
      const ack = `(corrección recibida: ${steer}) `;
      reply += ack;
      emitDelta(ack);
    }
    reply += word;
    emitDelta(word);
    await new Promise((resolve) => setTimeout(resolve, slowWordMs()));
  }
  if (sessionId) appendMessage(sessionId, { role: 'assistant', content: reply });
  return { reply, late: run.steers.slice(delivered).join('\n'), cancelled: false };
}
