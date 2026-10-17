import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { SessionActions } from '@/components/session-actions';
import { SessionRow } from '@/components/session-row';
import { Text } from '@/components/ui/text';
import { RequireConnection, useHermesClient } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useSwipeActions } from '@/contexts/swipe-actions-context';
import { useTheme } from '@/contexts/theme-context';
import {
  forgetArchived,
  refreshArchived,
  rememberArchived,
  unarchiveSession,
  useArchivedSessions,
} from '@/lib/archived-sessions';
import { confirmAction } from '@/lib/confirm';
import { describeHermesError, HermesError, type HermesSession } from '@/lib/hermes';
import { forgetSentImages } from '@/lib/sent-images';
import { useSessionActivity } from '@/lib/session-activity';
import type { SwipeActionId } from '@/lib/swipe-actions';

export default function ArchivadasScreen() {
  return (
    <RequireConnection>
      <ArchivadasBody />
    </RequireConnection>
  );
}

function ArchivadasBody() {
  const client = useHermesClient();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.archive;
  const insets = useSafeAreaInsets();
  const sessions = useArchivedSessions(client);
  const { config: swipe } = useSwipeActions();
  const activity = useSessionActivity();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<HermesSession | null>(null);
  const [menuRenaming, setMenuRenaming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    refreshArchived(client).then(
      () => {
        if (!cancelled) setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(describeHermesError(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function onPullRefresh() {
    setRefreshing(true);
    try {
      await refreshArchived(client);
      setError(null);
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setRefreshing(false);
    }
  }

  /** Corre una acción sobre una conversación con el indicador de ocupado y el error a la vista. */
  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      setMenu(null);
      setError(null);
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setBusy(false);
    }
  }

  function onUnarchive(source: HermesSession) {
    void act(async () => {
      await unarchiveSession(client, source);
    });
  }

  function onTogglePin(source: HermesSession) {
    void act(async () => {
      await rememberArchived(client, [await client.patchSession(source.id, { pinned: !source.pinned })]);
    });
  }

  function onRename(source: HermesSession, title: string) {
    void act(async () => {
      await rememberArchived(client, [await client.patchSession(source.id, { title })]);
    });
  }

  function onFork(source: HermesSession) {
    confirmAction({
      title: str.sessions.forkTitle,
      message: str.sessions.forkMessage,
      confirmLabel: str.swipe.actions.fork,
      onConfirm: () => {
        void act(async () => {
          const copy = await client.forkSession(source.id, str.sessions.copyTitle(source.title));
          router.push({ pathname: '/chat/[id]', params: { id: copy.id } });
        });
      },
    });
  }

  function onDelete(source: HermesSession) {
    confirmAction({
      title: str.sessions.deleteTitle,
      message: str.common.deleteFromServer,
      confirmLabel: str.common.delete,
      destructive: true,
      onConfirm: () => {
        void act(async () => {
          try {
            await client.deleteSession(source.id);
          } catch (err) {
            if (!(err instanceof HermesError && err.code === 'not_found')) throw err;
          }
          void forgetSentImages([source.id]);
          await forgetArchived(client, [source.id]);
        });
      },
    });
  }

  function onSwipeAction(session: HermesSession, action: SwipeActionId) {
    if (busy) return;
    switch (action) {
      case 'archive':
        onUnarchive(session);
        break;
      case 'delete':
        onDelete(session);
        break;
      case 'pin':
        onTogglePin(session);
        break;
      case 'rename':
        setMenuRenaming(true);
        setMenu(session);
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
  const openMenu = useCallback((session: HermesSession) => {
    setMenuRenaming(false);
    setMenu(session);
  }, []);
  const openSession = useCallback((session: HermesSession) => {
    router.push({ pathname: '/chat/[id]', params: { id: session.id, title: session.title } });
  }, []);

  return (
    <ScreenShell scroll={false} title={text.title} onBack={() => router.back()}>
      {sessions === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.pri} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          extraData={activity}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void onPullRefresh();
              }}
              tintColor={t.pri}
            />
          }
          ListHeaderComponent={
            <>
              <Text style={[styles.hint, { color: t.mut }]}>{text.hint}</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          }
          ListEmptyComponent={<Text style={[styles.empty, { color: t.mut }]}>{text.empty}</Text>}
          renderItem={({ item }) => {
            const status = activity.running.has(item.id)
              ? (activity.running.get(item.id) ?? str.sessions.responding)
              : null;
            const last = activity.last.get(item.id)?.message;
            const preview = last
              ? `${last.role === 'user' ? str.sessions.youPrefix : ''}${last.text}`
              : item.preview;
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
      <SessionActions
        session={menu}
        startRenaming={menuRenaming}
        busy={busy}
        onClose={() => setMenu(null)}
        onRename={(title) => {
          if (menu) onRename(menu, title);
        }}
        onTogglePin={() => {
          if (menu) onTogglePin(menu);
        }}
        onToggleArchive={() => {
          if (menu) onUnarchive(menu);
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingVertical: 12, fontSize: 14 },
  error: { paddingVertical: 12, fontSize: 14, color: '#ef4444' },
  empty: { paddingVertical: 32 },
});
