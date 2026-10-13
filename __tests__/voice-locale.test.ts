import {
  DEFAULT_VOICE_LOCALE,
  resolveVoiceLocale,
  voiceFailureMessage,
  voiceLocaleLabel,
  voiceMissedSpeech,
} from '@/lib/voice-locale';

describe('idioma de voz', () => {
  it('usa español de España si no hay uno guardado', () => {
    expect(resolveVoiceLocale(null)).toBe(DEFAULT_VOICE_LOCALE);
    expect(resolveVoiceLocale('')).toBe('es-ES');
    expect(resolveVoiceLocale('fr-FR')).toBe('es-ES');
  });

  it('conserva un idioma de la lista', () => {
    expect(resolveVoiceLocale('en-US')).toBe('en-US');
    expect(voiceLocaleLabel('es-MX')).toBe('Español (México)');
  });

  it('traduce fallos del reconocedor y calla cuando no hubo voz', () => {
    expect(voiceMissedSpeech('no-speech')).toBe(true);
    expect(voiceFailureMessage('no-speech')).toBeNull();
    expect(voiceFailureMessage('aborted')).toBeNull();
    expect(voiceFailureMessage('not-allowed')).toMatch(/micrófono/);
    expect(voiceFailureMessage('network')).toMatch(/conexión/);
  });
});
