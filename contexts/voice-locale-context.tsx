import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { deviceLanguageTags } from '@/lib/i18n';
import {
  resolveVoiceLocale,
  VOICE_LOCALE_STORAGE_KEY,
  voiceLocaleForDevice,
  voiceLocaleLabel,
  type VoiceLocaleId,
} from '@/lib/voice-locale';

type VoiceLocaleContextValue = {
  locale: VoiceLocaleId;
  label: string;
  setLocale: (id: VoiceLocaleId) => void;
};

const VoiceLocaleContext = createContext<VoiceLocaleContextValue | null>(null);

export function VoiceLocaleProvider({ children }: { children: React.ReactNode }) {
  const [deviceLocale] = useState(() => voiceLocaleForDevice(deviceLanguageTags()));
  const [locale, setLocaleState] = useState<VoiceLocaleId>(deviceLocale);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(VOICE_LOCALE_STORAGE_KEY);
        if (!cancelled) setLocaleState(resolveVoiceLocale(stored, deviceLocale));
      } catch {
        // Mantener el idioma del teléfono si falla el almacenamiento.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deviceLocale]);

  const setLocale = useCallback((id: VoiceLocaleId) => {
    const next = resolveVoiceLocale(id);
    setLocaleState(next);
    AsyncStorage.setItem(VOICE_LOCALE_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ locale, label: voiceLocaleLabel(locale), setLocale }),
    [locale, setLocale],
  );

  return <VoiceLocaleContext.Provider value={value}>{children}</VoiceLocaleContext.Provider>;
}

export function useVoiceLocale() {
  const ctx = useContext(VoiceLocaleContext);
  if (!ctx) {
    throw new Error('useVoiceLocale debe usarse dentro de VoiceLocaleProvider');
  }
  return ctx;
}
