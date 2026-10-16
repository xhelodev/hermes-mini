import { getLocales } from 'expo-localization';

import { en } from './en';
import { es, type Messages } from './es';

export type { Messages } from './es';

export const LANGUAGES = ['es', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Idioma si el del teléfono no está traducido. */
export const FALLBACK_LANGUAGE: Language = 'en';

const MESSAGES: Record<Language, Messages> = { es, en };

function baseLanguage(tag: string | null | undefined): string {
  return (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

function isLanguage(code: string): code is Language {
  return (LANGUAGES as readonly string[]).includes(code);
}

/** Primer idioma soportado en la lista de preferencias del teléfono (BCP 47). */
export function resolveLanguage(tags: readonly (string | null | undefined)[]): Language {
  for (const tag of tags) {
    const code = baseLanguage(tag);
    if (isLanguage(code)) return code;
  }
  return FALLBACK_LANGUAGE;
}

/** Idiomas preferidos del teléfono, en orden. Vacío si no se pueden leer. */
export function deviceLanguageTags(): string[] {
  try {
    return getLocales().map((locale) => locale.languageTag);
  } catch {
    return [];
  }
}

let current: Language = resolveLanguage(deviceLanguageTags());

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language) {
  current = language;
}

/** Textos del idioma actual. Fuera de componentes; en pantallas usá `useStrings`. */
export function strings(): Messages {
  return MESSAGES[current];
}

export function messagesFor(language: Language): Messages {
  return MESSAGES[language];
}
