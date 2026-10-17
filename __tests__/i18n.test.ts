import { messagesFor, resolveLanguage, setLanguage, strings } from '@/lib/i18n';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { describeSchedule } from '@/lib/schedule';
import { voiceLocaleForDevice } from '@/lib/voice-locale';

function shape(value: unknown): unknown {
  if (typeof value === 'function') return `fn/${value.length}`;
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, shape((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

describe('idioma de la app', () => {
  afterEach(() => setLanguage('es'));

  it('toma el primer idioma soportado del teléfono', () => {
    expect(resolveLanguage(['es-AR'])).toBe('es');
    expect(resolveLanguage(['en_GB'])).toBe('en');
    expect(resolveLanguage(['fr-FR', 'es-MX'])).toBe('es');
  });

  it('cae en inglés si ninguno está traducido', () => {
    expect(resolveLanguage(['fr-FR', 'de-DE'])).toBe('en');
    expect(resolveLanguage([])).toBe('en');
  });

  it('tiene las mismas claves en español e inglés', () => {
    expect(shape(en)).toEqual(shape(es));
  });

  it('cambia los textos fuera de componentes', () => {
    setLanguage('en');
    expect(strings()).toBe(messagesFor('en'));
    expect(describeSchedule('0 9 * * *')).toBe('Every day at 09:00');
    setLanguage('es');
    expect(describeSchedule('0 9 * * *')).toBe('Todos los días a las 09:00');
  });
});

describe('idioma de voz del teléfono', () => {
  it('elige la variante exacta o la primera del mismo idioma', () => {
    expect(voiceLocaleForDevice(['es-AR'])).toBe('es-AR');
    expect(voiceLocaleForDevice(['es-CL'])).toBe('es-ES');
    expect(voiceLocaleForDevice(['en-GB'])).toBe('en-US');
    expect(voiceLocaleForDevice(['pt-PT'])).toBe('pt-BR');
  });

  it('usa inglés si el teléfono no tiene un idioma de la lista', () => {
    expect(voiceLocaleForDevice(['fr-FR'])).toBe('en-US');
    expect(voiceLocaleForDevice([])).toBe('en-US');
  });
});
