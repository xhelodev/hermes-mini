import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  DEFAULT_SWIPE_CONFIG,
  resolveSwipeConfig,
  SWIPE_CONFIG_STORAGE_KEY,
  type SwipeActionId,
  type SwipeConfig,
  type SwipeDirection,
} from '@/lib/swipe-actions';

type SwipeActionsContextValue = {
  config: SwipeConfig;
  setAction: (direction: SwipeDirection, action: SwipeActionId) => void;
};

const SwipeActionsContext = createContext<SwipeActionsContextValue | null>(null);

export function SwipeActionsProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SwipeConfig>(DEFAULT_SWIPE_CONFIG);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(SWIPE_CONFIG_STORAGE_KEY);
        if (!cancelled) setConfig(resolveSwipeConfig(stored));
      } catch {
        // Mantener los gestos por defecto si falla el almacenamiento.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAction = useCallback((direction: SwipeDirection, action: SwipeActionId) => {
    setConfig((current) => {
      const next = { ...current, [direction]: action };
      AsyncStorage.setItem(SWIPE_CONFIG_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ config, setAction }), [config, setAction]);

  return <SwipeActionsContext.Provider value={value}>{children}</SwipeActionsContext.Provider>;
}

export function useSwipeActions() {
  const ctx = useContext(SwipeActionsContext);
  if (!ctx) {
    throw new Error('useSwipeActions debe usarse dentro de SwipeActionsProvider');
  }
  return ctx;
}
