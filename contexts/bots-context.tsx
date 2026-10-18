import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useConnection, useHermesClient } from '@/contexts/connection-context';
import { botBaseUrl, loadBotKeys, loadBots, saveBotKey, saveBots } from '@/lib/bots';
import { HermesClient, HermesError } from '@/lib/hermes';

/** Cómo responde el servidor a un Bot con una clave. */
export type BotAccess = 'ok' | 'needs_key' | 'missing';

type BotsContextValue = {
  /** Los Bots agregados para este servidor, en el orden en que se agregaron. */
  bots: string[];
  hydrated: boolean;
  hasOwnKey: (bot: string) => boolean;
  /** Un cliente estable por Bot (y por clave), para que las cachés por cliente sirvan. */
  clientFor: (bot: string) => HermesClient | null;
  /** Prueba un Bot con `key`, o con la que usaría la app: la suya o la del servidor. */
  check: (bot: string, key?: string) => Promise<BotAccess>;
  /** Agrega o actualiza un Bot. Sin `key` conserva la clave que tenga. */
  saveBot: (bot: string, key?: string) => Promise<void>;
  removeBot: (bot: string) => Promise<void>;
};

const BotsContext = createContext<BotsContextValue | null>(null);

function accessOf(error: unknown): BotAccess {
  if (error instanceof HermesError && error.code === 'unauthorized') return 'needs_key';
  // Hermes responde 404 a un perfil que no existe, o si no atiende perfiles.
  if (error instanceof HermesError && error.code === 'not_found') return 'missing';
  throw error;
}

export function BotsProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl, apiKey } = useConnection();
  // Atado al servidor que los cargó: al cambiar de servidor no se mezclan.
  const [loaded, setLoaded] = useState<{ baseUrl: string; bots: string[]; keys: Record<string, string> } | null>(
    null,
  );
  const current = loaded && loaded.baseUrl === baseUrl ? loaded : null;
  const clients = useRef(new Map<string, HermesClient>());

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    void Promise.all([loadBots(baseUrl), loadBotKeys(baseUrl)])
      .then(([bots, keys]) => {
        if (!cancelled) setLoaded({ baseUrl, bots, keys });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ baseUrl, bots: [], keys: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const makeClient = useCallback(
    (bot: string, key: string) => new HermesClient({ baseUrl: botBaseUrl(baseUrl, bot), apiKey: key }),
    [baseUrl],
  );

  const clientFor = useCallback(
    (bot: string) => {
      if (!baseUrl || !apiKey) return null;
      const key = current?.keys[bot] || apiKey;
      const id = `${baseUrl}\n${bot}\n${key}`;
      let client = clients.current.get(id);
      if (!client) {
        client = makeClient(bot, key);
        clients.current.set(id, client);
      }
      return client;
    },
    [baseUrl, apiKey, current, makeClient],
  );

  const check = useCallback(
    async (bot: string, key?: string) => {
      try {
        await makeClient(bot, key?.trim() || current?.keys[bot] || apiKey).checkAccess();
        return 'ok' as const;
      } catch (error) {
        return accessOf(error);
      }
    },
    [apiKey, current, makeClient],
  );

  const saveBot = useCallback(
    async (bot: string, key?: string) => {
      if (!current) return;
      const bots = current.bots.includes(bot) ? current.bots : [...current.bots, bot];
      const keys = { ...current.keys };
      const own = key?.trim();
      if (own) {
        keys[bot] = own;
        await saveBotKey(baseUrl, bot, own);
      }
      await saveBots(baseUrl, bots);
      setLoaded({ baseUrl, bots, keys });
    },
    [baseUrl, current],
  );

  const removeBot = useCallback(
    async (bot: string) => {
      if (!current) return;
      const bots = current.bots.filter((name) => name !== bot);
      const keys = { ...current.keys };
      delete keys[bot];
      await saveBotKey(baseUrl, bot, null);
      await saveBots(baseUrl, bots);
      setLoaded({ baseUrl, bots, keys });
    },
    [baseUrl, current],
  );

  const hasOwnKey = useCallback((bot: string) => Boolean(current?.keys[bot]), [current]);

  const value = useMemo(
    () => ({
      bots: current?.bots ?? [],
      hydrated: current !== null,
      hasOwnKey,
      clientFor,
      check,
      saveBot,
      removeBot,
    }),
    [current, hasOwnKey, clientFor, check, saveBot, removeBot],
  );

  return <BotsContext.Provider value={value}>{children}</BotsContext.Provider>;
}

export function useBots(): BotsContextValue {
  const ctx = useContext(BotsContext);
  if (!ctx) throw new Error('useBots debe usarse dentro de BotsProvider');
  return ctx;
}

const BotScopeContext = createContext<string | null>(null);

/** Lo que va adentro habla con ese Bot (su perfil) en vez del servidor principal. */
export function BotScope({ bot, children }: { bot: string | null; children: React.ReactNode }) {
  return <BotScopeContext.Provider value={bot || null}>{children}</BotScopeContext.Provider>;
}

/** El Bot de esta pantalla, o `null` si es el servidor principal. */
export function useBotScope(): string | null {
  return useContext(BotScopeContext);
}

/** Como `useHermesClient`, pero dentro de un `BotScope` apunta a ese Bot. */
export function useScopedClient(): HermesClient {
  const bot = useBotScope();
  const main = useHermesClient();
  const { clientFor } = useBots();
  return (bot ? clientFor(bot) : null) ?? main;
}
