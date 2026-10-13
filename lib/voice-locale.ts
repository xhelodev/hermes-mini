export const VOICE_LOCALES = [
  { id: 'es-ES', label: 'Español (España)' },
  { id: 'es-MX', label: 'Español (México)' },
  { id: 'es-AR', label: 'Español (Argentina)' },
  { id: 'es-CO', label: 'Español (Colombia)' },
  { id: 'es-US', label: 'Español (Estados Unidos)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
] as const;

export type VoiceLocaleId = (typeof VOICE_LOCALES)[number]['id'];

export const DEFAULT_VOICE_LOCALE: VoiceLocaleId = 'es-ES';

export const VOICE_LOCALE_STORAGE_KEY = '@hermes/voice-locale';

export function resolveVoiceLocale(stored: string | null | undefined): VoiceLocaleId {
  const match = VOICE_LOCALES.find((item) => item.id === stored);
  return match?.id ?? DEFAULT_VOICE_LOCALE;
}

export function voiceLocaleLabel(id: string): string {
  const match = VOICE_LOCALES.find((item) => item.id === id);
  if (match) return match.label;
  return VOICE_LOCALES.find((item) => item.id === DEFAULT_VOICE_LOCALE)?.label ?? 'Español (España)';
}

const MISSED_SPEECH = new Set(['no-speech', 'speech-timeout']);

export function voiceMissedSpeech(code: string): boolean {
  return MISSED_SPEECH.has(code);
}

export function voiceFailureMessage(code: string): string | null {
  if (code === 'aborted' || voiceMissedSpeech(code)) return null;
  switch (code) {
    case 'not-allowed':
      return 'Hermes Go necesita el micrófono para dictar.';
    case 'network':
      return 'El reconocimiento de voz necesita conexión.';
    case 'language-not-supported':
      return 'Ese idioma de voz no está en este teléfono.';
    default:
      return 'No se pudo dictar el mensaje.';
  }
}
