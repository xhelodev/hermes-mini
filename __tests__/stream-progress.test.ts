import {
  advanceStatus,
  createStreamWatchdog,
  elapsedLabel,
  phaseAfterEvent,
  phaseLabel,
  statusLabel,
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
