import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Redirect } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HermesClient, normalizeBaseUrl, type ModelSelection } from '@/lib/hermes';

const URL_KEY = '@hermes/server-url';
const MODEL_KEY = '@hermes/default-model';
const SESSION_MODELS_KEY = '@hermes/session-models';
const API_KEY_KEY = 'hermes_api_key';

type ConnectionContextValue = {
  hydrated: boolean;
  baseUrl: string;
  apiKey: string;
  isReady: boolean;
  client: HermesClient | null;
  defaultModel: ModelSelection | null;
  modelForSession: (sessionId: string) => ModelSelection | null;
  saveConnection: (baseUrl: string, apiKey: string) => Promise<void>;
  clearConnection: () => Promise<void>;
  setDefaultModel: (model: ModelSelection) => void;
  setSessionModel: (sessionId: string, model: ModelSelection) => void;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

function parseModel(raw: string | null): ModelSelection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ModelSelection>;
    if (!value.providerId || !value.modelId || !value.label) return null;
    return {
      providerId: value.providerId,
      modelId: value.modelId,
      label: value.label,
      providerLabel: value.providerLabel || value.providerId,
    };
  } catch {
    return null;
  }
}

function parseModelMap(raw: string | null): Record<string, ModelSelection> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, Partial<ModelSelection>>;
    const next: Record<string, ModelSelection> = {};
    for (const [sessionId, model] of Object.entries(value)) {
      if (!model?.providerId || !model.modelId || !model.label) continue;
      next[sessionId] = {
        providerId: model.providerId,
        modelId: model.modelId,
        label: model.label,
        providerLabel: model.providerLabel || model.providerId,
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModelState] = useState<ModelSelection | null>(null);
  const [sessionModels, setSessionModels] = useState<Record<string, ModelSelection>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [storedUrl, storedModel, storedSessionModels, storedKey] = await Promise.all([
          AsyncStorage.getItem(URL_KEY),
          AsyncStorage.getItem(MODEL_KEY),
          AsyncStorage.getItem(SESSION_MODELS_KEY),
          SecureStore.getItemAsync(API_KEY_KEY).catch(() => null),
        ]);
        if (cancelled) return;
        setBaseUrl(storedUrl ?? '');
        setApiKey(storedKey ?? '');
        setDefaultModelState(parseModel(storedModel));
        setSessionModels(parseModelMap(storedSessionModels));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const client = useMemo(() => {
    if (!baseUrl.trim() || !apiKey.trim()) return null;
    try {
      return new HermesClient({ baseUrl: normalizeBaseUrl(baseUrl), apiKey });
    } catch {
      return null;
    }
  }, [baseUrl, apiKey]);

  const saveConnection = useCallback(async (nextUrl: string, nextKey: string) => {
    const normalized = normalizeBaseUrl(nextUrl);
    const key = nextKey.trim();
    await SecureStore.setItemAsync(API_KEY_KEY, key);
    await AsyncStorage.setItem(URL_KEY, normalized);
    setBaseUrl(normalized);
    setApiKey(key);
  }, []);

  const clearConnection = useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(API_KEY_KEY).catch(() => undefined),
      AsyncStorage.multiRemove([URL_KEY, MODEL_KEY, SESSION_MODELS_KEY]),
    ]);
    setBaseUrl('');
    setApiKey('');
    setDefaultModelState(null);
    setSessionModels({});
  }, []);

  const setDefaultModel = useCallback((model: ModelSelection) => {
    setDefaultModelState(model);
    AsyncStorage.setItem(MODEL_KEY, JSON.stringify(model)).catch(() => undefined);
  }, []);

  const setSessionModel = useCallback((sessionId: string, model: ModelSelection) => {
    setSessionModels((current) => {
      const next = { ...current, [sessionId]: model };
      AsyncStorage.setItem(SESSION_MODELS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const modelForSession = useCallback(
    (sessionId: string) => sessionModels[sessionId] ?? defaultModel,
    [sessionModels, defaultModel],
  );

  const value = useMemo(
    () => ({
      hydrated,
      baseUrl,
      apiKey,
      isReady: client !== null,
      client,
      defaultModel,
      modelForSession,
      saveConnection,
      clearConnection,
      setDefaultModel,
      setSessionModel,
    }),
    [
      hydrated,
      baseUrl,
      apiKey,
      client,
      defaultModel,
      modelForSession,
      saveConnection,
      clearConnection,
      setDefaultModel,
      setSessionModel,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) {
    throw new Error('useConnection debe usarse dentro de ConnectionProvider');
  }
  return ctx;
}

export function useHermesClient(): HermesClient {
  const { client } = useConnection();
  if (!client) {
    throw new Error('Hermes Go no está conectado');
  }
  return client;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

export function RequireConnection({ children }: { children: React.ReactNode }) {
  const { hydrated, isReady } = useConnection();
  if (!hydrated) return <View style={styles.flex} />;
  if (!isReady) return <Redirect href="/conexion" />;
  return children;
}
