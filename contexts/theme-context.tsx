import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DEFAULT_THEME_ID,
  getThemeById,
  THEME_STORAGE_KEY,
  type ThemeDefinition,
  type ThemeId,
} from '@/lib/themes';

type ThemeContextValue = {
  theme: ThemeDefinition;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  hydrated: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (stored && !cancelled) {
          setThemeIdState(stored as ThemeId);
        }
      } catch {
        // Mantener tema por defecto si falla el almacenamiento.
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    AsyncStorage.setItem(THEME_STORAGE_KEY, id).catch(() => undefined);
  }, []);

  const theme = useMemo(() => getThemeById(themeId), [themeId]);

  const value = useMemo(
    () => ({ theme, themeId, setThemeId, hydrated }),
    [theme, themeId, setThemeId, hydrated],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de ThemeProvider');
  }
  return ctx;
}
