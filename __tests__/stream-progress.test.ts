import { strings } from '@/lib/i18n';
import {
  advanceStatus,
  createStreamWatchdog,
  elapsedLabel,
  phaseAfterEvent,
  phaseLabel,
  runFailureMessage,
  statusLabel,
  stopReason,
  turnInterrupted,
} from '@/lib/stream-progress';

describe('etapas de una respuesta', () => {
  it('traduce los eventos del stream a etapas', () => {
    expect(phaseAfterEvent('assistant.delta', { delta: 'Ho' })).toEqual({ kind: 'writing' });
    expect(phaseAfterEvent('reasoning.delta', { text: 'mmm' })).toEqual({ kind: 'reasoning' });
    expect(phaseAfterEvent('tool.started', { tool_name: 'terminal' })).toEqual({ kind: 'tool', name: 'terminal' });
    expect(phaseAfterEvent('tool.completed', {})).toEqual({ kind: 'thinking' });
    expect(phaseAfterEvent('approval.request', {})).toEqual({ kind: 'approval' });
    expect(phaseAfterEvent('assistant.completed', {})).toBeNull();
  });

  it('nombra cada etapa', () => {
    expect(phaseLabel({ kind: 'uploading', percent: 40 })).toBe('Subiendo adjuntos… 40%');
    expect(phaseLabel({ kind: 'uploading', percent: null })).toBe('Subiendo adjuntos…');
    expect(phaseLabel({ kind: 'tool', name: 'terminal' })).toBe('Usando terminal…');
    expect(statusLabel({ phase: { kind: 'thinking' }, since: 0, slow: true })).toBe('La conexión parece lenta…');
  });

  it('conserva el estado si la etapa no cambia y reinicia el reloj si cambia', () => {
    const thinking = advanceStatus(null, { kind: 'thinking' }, 1000);
    expect(thinking).toEqual({ phase: { kind: 'thinking' }, since: 1000, slow: false });
    expect(advanceStatus(thinking, { kind: 'thinking' }, 5000)).toBe(thinking);
    expect(advanceStatus(thinking, { kind: 'tool', name: 'web' }, 5000).since).toBe(5000);
  });

  it('mantiene el reloj mientras avanza la subida', () => {
    const start = advanceStatus(null, { kind: 'uploading', percent: 0 }, 1000);
    const later = advanceStatus(start, { kind: 'uploading', percent: 60 }, 3000);
    expect(later).toEqual({ phase: { kind: 'uploading', percent: 60 }, since: 1000, slow: false });
  });

  it('muestra el tiempo solo cuando la espera se alarga', () => {
    expect(elapsedLabel(4999)).toBeNull();
    expect(elapsedLabel(12_400)).toBe('12 s');
    expect(elapsedLabel(65_000)).toBe('1 min 05 s');
  });
});

describe('cierre de un turno que falló', () => {
  const describe_ = () => 'No se pudo conectar con el servidor.';

  it('da la conexión por perdida cuando el vigía la corta', () => {
    expect(stopReason({ lost: true, aborted: false, backgrounded: true, describe: describe_ })).toEqual({
      message: 'Se perdió la conexión: el servidor dejó de responder.',
      recover: false,
    });
  });

  it('no avisa nada si el usuario canceló', () => {
    expect(stopReason({ lost: false, aborted: true, backgrounded: true, describe: describe_ })).toEqual({
      message: null,
      recover: false,
    });
  });

  it('recupera el turno, sin error, si se minimizó la app', () => {
    expect(stopReason({ lost: false, aborted: false, backgrounded: true, describe: describe_ })).toEqual({
      message: null,
      recover: true,
    });
  });

  it('muestra el error común en cualquier otro corte', () => {
    expect(stopReason({ lost: false, aborted: false, backgrounded: false, describe: describe_ })).toEqual({
      message: 'No se pudo conectar con el servidor.',
      recover: false,
    });
  });
});

describe('vigilancia del stream', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('avisa la lentitud, la retira con datos y corta si no llega nada', () => {
    const onSlow = jest.fn();
    const onDead = jest.fn();
    const watchdog = createStreamWatchdog({ slowMs: 3000, deadMs: 6000, onSlow, onDead });

    jest.advanceTimersByTime(3000);
    expect(onSlow).toHaveBeenLastCalledWith(true);

    watchdog.touch();
    expect(onSlow).toHaveBeenLastCalledWith(false);

    jest.advanceTimersByTime(5000);
    expect(onDead).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(onDead).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10_000);
    expect(onDead).toHaveBeenCalledTimes(1);
  });

  it('no cuenta el tiempo en pausa, como al esperar una aprobación', () => {
    const onSlow = jest.fn();
    const onDead = jest.fn();
    const watchdog = createStreamWatchdog({ slowMs: 3000, deadMs: 6000, onSlow, onDead });

    watchdog.pause();
    jest.advanceTimersByTime(20_000);
    expect(onSlow).not.toHaveBeenCalled();
    expect(onDead).not.toHaveBeenCalled();

    watchdog.resume();
    jest.advanceTimersByTime(2000);
    expect(onSlow).not.toHaveBeenCalled();
    watchdog.stop();
  });
});

describe('fallo de un turno', () => {
  it('lee el error de run.failed y de la caída del agente', () => {
    expect(runFailureMessage('run.failed', { error: 'Sin crédito' })).toBe('Sin crédito');
    expect(runFailureMessage('run.failed', { error: { message: 'Límite' } })).toBe('Límite');
    expect(runFailureMessage('error', { message: 'Se cayó el proveedor' })).toBe('Se cayó el proveedor');
  });

  it('usa un texto genérico si el servidor no explica', () => {
    expect(runFailureMessage('error', {})).toBe(strings().chat.runFailed);
    expect(runFailureMessage('run.failed', { error: '  ' })).toBe(strings().chat.runFailed);
  });

  it('no trata otros eventos como fallo', () => {
    expect(runFailureMessage('run.completed', { error: 'x' })).toBeNull();
    expect(runFailureMessage('done', {})).toBeNull();
  });
});

describe('turno cortado al minimizar', () => {
  const user = { role: 'user', text: 'Contame algo', finishReason: null };
  const tool = { role: 'tool', text: '{"output": "ok"}', finishReason: null };
  const step = { role: 'assistant', text: '', finishReason: 'tool_calls' };

  it('lo da por terminado si la respuesta cerró con finish_reason', () => {
    expect(turnInterrupted([user, step, tool, { role: 'assistant', text: 'Listo.', finishReason: 'stop' }])).toBe(false);
  });

  it('lo da por cortado si Hermes guardó solo parte de la respuesta', () => {
    expect(turnInterrupted([user, { role: 'assistant', text: 'La historia empieza en', finishReason: null }])).toBe(true);
  });

  it('lo da por cortado si nadie respondió, aunque haya pasos con herramientas', () => {
    expect(turnInterrupted([user, step, tool, { role: 'assistant', text: '', finishReason: null }])).toBe(true);
  });

  it('no avisa nada en una conversación vacía', () => {
    expect(turnInterrupted([])).toBe(false);
  });
});
