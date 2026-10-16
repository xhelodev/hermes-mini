import { useLocales } from 'expo-localization';
import React, { createContext, useContext } from 'react';

import { messagesFor, resolveLanguage, setLanguage, type Language, type Messages } from '@/lib/i18n';

const I18nContext = createContext<Language | null>(null);

/** Toma el idioma del teléfono y vuelve a dibujar la app si cambia. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locales = useLocales();
  const language = resolveLanguage(locales.map((locale) => locale.languageTag));
  // Los textos fuera de componentes (`strings()`) leen el mismo idioma.
  setLanguage(language);
  return <I18nContext.Provider value={language}>{children}</I18nContext.Provider>;
}

export function useLanguage(): Language {
  const language = useContext(I18nContext);
  if (!language) {
    throw new Error('useLanguage debe usarse dentro de I18nProvider');
  }
  return language;
}

export function useStrings(): Messages {
  return messagesFor(useLanguage());
}
