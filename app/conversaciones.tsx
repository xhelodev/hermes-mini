import { router, useFocusEffect } from 'expo-router';
import { CalendarDaysIcon, Cog6ToothIcon, PlusIcon } from 'react-native-heroicons/outline';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { SessionActions } from '@/components/session-actions';
import { SessionRow } from '@/components/session-row';
import { Text } from '@/components/ui/text';
import { RequireConnection, useHermesClient } from '@/contexts/connection-context';
import { useSwipeActions } from '@/contexts/swipe-actions-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { confirmAction } from '@/lib/confirm';
import { lastMessageIsStale, rememberLastMessage, useSessionActivity } from '@/lib/session-activity';
import {
  cachedSessions,
  keepUnchanged,
  loadStoredSessions,
  rememberSessions,
} from '@/lib/session-list-cache';
import type { SwipeActionId } from '@/lib/swipe-actions';
import { describeHermesError, type HermesSession } from '@/lib/hermes';

/** Al volver a la pantalla no se repite la carga si la anterior fue hace menos de esto. */
const FOCUS_REFRESH_MS = 2000;

export default function ConversacionesScreen() {
  return (
    <RequireConnection>
      <ConversacionesBody />
    </RequireConnection>
  );
}

function ConversacionesBody() {
  const client = useHermesClient();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.sessions;
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<HermesSession[] | null>(() => cachedSessions(client) ?? null);
  // Solo se guarda lo que vino del servidor (o ya estaba en memoria), nunca el `[]` de un error.
  const [synced, setSynced] = useState(() => cachedSessions(client) !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<HermesSession | null>(null);
  const [menuRenaming, setMenuRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { config: swipe } = useSwipeActions();
  const inFlight = useRef<Promise<void> | null>(null);
  const lastLoadAt = useRef(0);
  const activity = useSessionActivity();
  const visible = useRef<HermesSession[]>([]);
  const fetchingLast = useRef(new Set<string>());

  // El `preview` del servidor es el primer mensaje; el último lo pedimos para las filas visibles.
  const fetchLastMessages = useCallback(
    (rows: HermesSession[]) => {
      for (const session of rows) {
        if (fetchingLast.current.has(session.id)) continue;
        if (!lastMessageIsStale(session.id, session.updatedAt)) continue;
        fetchingLast.current.add(session.id);
        client
          .getLastMessage(session.id)
          .then((message) => {
            const readable =
              message && (message.role === 'user' || message.role === 'assistant') && message.text.trim();
            rememberLastMessage(
              session.id,
              readable ? { role: message.role, text: message.text } : null,
              session.updatedAt,
            );
          })
          .catch(() => undefined)
          .finally(() => fetchingLast.current.delete(session.id));
      }
    },
    [client],
  );
  const fetchLastRef = useRef(fetchLastMessages);
  useEffect(() => {
    fetchLastRef.current = fetchLastMessages;
  }, [fetchLastMessages]);
  // FlatList no admite cambiar este callback entre renders.
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken<HermesSession>[] }) => {
        visible.current = viewableItems.map((token) => token.item);
        fetchLastRef.current(visible.current);
      },
  );

  function replaceSession(next: HermesSession) {
    setSessions((current) => {
      const list = (current ?? []).map((item) => (item.id === next.id ? next : item));
      return list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      });
    });
    setMenu((current) => (current?.id === next.id ? next : current));
  }

  // Arranque en frío: mientras llega el servidor se pinta la última lista guardada.
  useEffect(() => {
    let cancelled = false;
    void loadStoredSessions(client).then((stored) => {
      if (!cancelled && stored) setSessions((current) => current ?? stored);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (synced && sessions) rememberSessions(client, sessions);
  }, [client, synced, sessions]);

  /** Refresca en silencio; el spinner de arriba solo aparece si el usuario tiró de la lista. */
  const load = useCallback(
    (pull = false) => {
      if (pull) setRefreshing(true);
      if (inFlight.current) return inFlight.current;
      if (!pull && Date.now() - lastLoadAt.current < FOCUS_REFRESH_MS) return Promise.resolve();
      const run = (async () => {
        try {
          const next = await client.listSessions();
          lastLoadAt.current = Date.now();
          setSessions((current) => keepUnchanged(current, next));
          setSynced(true);
          const shown = new Set(visible.current.map((session) => session.id));
          fetchLastMessages(next.filter((session) => shown.has(session.id)));
          setError(null);
        } catch (err) {
          setError(describeHermesError(err));
          setSessions((current) => current ?? []);
        } finally {
          inFlight.current = null;
          setRefreshing(false);
        }
      })();
      inFlight.current = run;
      return run;
    },
    [client, fetchLastMessages],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRename(title: string) {
    if (!menu) return;
    setBusy(true);
    try {
      const next = await client.patchSession(menu.id, { title });
      replaceSession(next);
      setMenu(null);
      setError(null);
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePin(source: HermesSession) {
    setBusy(true);
    try {
      const next = await client.patchSession(source.id, {
        pinned: !source.pinned,
      });
      replaceSession(next);
      setMenu(null);
      setError(null);
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setBusy(false);
    }
  }

  function onFork(source: HermesSession) {
    const branch = () => {
      void (async () => {
        setBusy(true);
        try {
          const copy = await client.forkSession(source.id, text.copyTitle(source.title));
          setMenu(null);
          setError(null);
          router.push({ pathname: '/chat/[id]', params: { id: copy.id } });
        } catch (err) {
          setError(describeHermesError(err));
        } finally {
          setBusy(false);
        }
      })();
    };
    confirmAction({
      title: text.forkTitle,
      message: text.forkMessage,
      confirmLabel: str.swipe.actions.fork,
      onConfirm: branch,
    });
  }

  function onDelete(source: HermesSession) {
    const remove = () => {
      void (async () => {
        setBusy(true);
        try {
          await client.deleteSession(source.id);
          setSessions((current) => (current ?? []).filter((item) => item.id !== source.id));
          setMenu((current) => (current?.id === source.id ? null : current));
          setError(null);
        } catch (err) {
          setError(describeHermesError(err));
        } finally {
          setBusy(false);
        }
      })();
    };
    confirmAction({
      title: text.deleteTitle,
      message: str.common.deleteFromServer,
      confirmLabel: str.common.delete,
      destructive: true,
      onConfirm: remove,
    });
  }

  const openMenu = useCallback((session: HermesSession, renaming = false) => {
    setMenuRenaming(renaming);
    setMenu(session);
  }, []);

  const openSession = useCallback((session: HermesSession) => {
    router.push({ pathname: '/chat/[id]', params: { id: session.id, title: session.title } });
  }, []);

  function onSwipeAction(session: HermesSession, action: SwipeActionId) {
    if (busy) return;
    switch (action) {
      case 'delete':
        onDelete(session);
        break;
      case 'pin':
        void onTogglePin(session);
        break;
      case 'rename':
        openMenu(session, true);
        break;
      case 'fork':
        onFork(session);
        break;
    }
  }

  // Las filas memoizadas reciben una función estable que llama siempre a la versión actual.
  const swipeActionRef = useRef(onSwipeAction);
  useEffect(() => {
    swipeActionRef.current = onSwipeAction;
  });
  const handleSwipeAction = useCallback(
    (session: HermesSession, action: SwipeActionId) => swipeActionRef.current(session, action),
    [],
  );

  async function onCreate() {
    setCreating(true);
    try {
      const session = await client.createSession();
      router.push({ pathname: '/chat/[id]', params: { id: session.id } });
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setCreating(false);
    }
  }

  const loading = sessions === null && !error;

  return (
    <ScreenShell
      scroll={false}
      title={text.title}
      headerRight={
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={str.jobs.title}
            hitSlop={8}
            onPress={() => router.push('/jobs')}
          >
            <CalendarDaysIcon color={t.fg} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={str.settings.title}
            hitSlop={8}
            onPress={() => router.push('/temas')}
          >
            <Cog6ToothIcon color={t.fg} size={22} />
          </Pressable>
        </View>
      }
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.pri} />
        </View>
      ) : (
        <FlatList
          data={sessions ?? []}
          keyExtractor={(item) => item.id}
          extraData={activity}
          onViewableItemsChanged={onViewableItemsChanged}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 96,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void load(true);
              }}
              tintColor={t.pri}
            />
          }
          ListHeaderComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : null
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.mut }]}>{text.empty}</Text>
          }
          renderItem={({ item }) => {
            const status = activity.running.has(item.id)
              ? (activity.running.get(item.id) ?? text.responding)
              : null;
            const last = activity.last.get(item.id)?.message;
            const preview = last ? `${last.role === 'user' ? text.youPrefix : ''}${last.text}` : item.preview;
            return (
              <SessionRow
                session={item}
                status={status}
                preview={preview}
                leftAction={swipe.left}
                rightAction={swipe.right}
                busy={busy}
                onOpen={openSession}
                onMenu={openMenu}
                onAction={handleSwipeAction}
              />
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.newTitle}
        disabled={creating}
        onPress={() => {
          void onCreate();
        }}
        style={[
          styles.fab,
          {
            backgroundColor: t.pri,
            opacity: creating ? 0.5 : 1,
            bottom: insets.bottom + 24,
          },
        ]}
      >
        {creating ? <ActivityIndicator color={t.pfg} /> : <PlusIcon color={t.pfg} size={28} />}
      </Pressable>
      <SessionActions
        session={menu}
        startRenaming={menuRenaming}
        busy={busy}
        onClose={() => setMenu(null)}
        onRename={(title) => {
          void onRename(title);
        }}
        onTogglePin={() => {
          if (menu) void onTogglePin(menu);
        }}
        onFork={() => {
          if (menu) onFork(menu);
        }}
        onDelete={() => {
          if (menu) onDelete(menu);
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { paddingVertical: 12, fontSize: 14, color: '#ef4444' },
  empty: { paddingVertical: 32 },
  fab: {
    position: 'absolute',
    right: 16,
    height: 56,
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
});
