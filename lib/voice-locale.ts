import { strings } from '@/lib/i18n';

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

export function resolveVoiceLocale(
  stored: string | null | undefined,
  fallback: VoiceLocaleId = DEFAULT_VOICE_LOCALE,
): VoiceLocaleId {
  const match = VOICE_LOCALES.find((item) => item.id === stored);
  return match?.id ?? fallback;
}

/**
 * Idioma de voz que más se parece a los del teléfono (BCP 47, en orden de preferencia):
 * primero la variante exacta (`es-AR`), si no la primera del mismo idioma (`en-GB` → `en-US`).
 */
export function voiceLocaleForDevice(tags: readonly string[]): VoiceLocaleId {
  const normalized = tags.map((tag) => tag.trim().replace('_', '-').toLowerCase());
  for (const tag of normalized) {
    const exact = VOICE_LOCALES.find((item) => item.id.toLowerCase() === tag);
    if (exact) return exact.id;
    const language = tag.split('-')[0];
    const sameLanguage = VOICE_LOCALES.find((item) => item.id.toLowerCase().split('-')[0] === language);
    if (sameLanguage) return sameLanguage.id;
  }
  // Sin coincidencias la app queda en inglés (ver `FALLBACK_LANGUAGE`).
  return 'en-US';
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
  const text = strings().voice;
  switch (code) {
    case 'not-allowed':
      return text.needsMicrophone;
    case 'network':
      return text.needsNetwork;
    case 'language-not-supported':
      return text.languageMissing;
    default:
      return text.failed;
  }
}
