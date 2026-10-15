import { router, useFocusEffect } from 'expo-router';
import { CalendarDaysIcon, Cog6ToothIcon, PlusIcon } from 'react-native-heroicons/outline';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { SessionActions } from '@/components/session-actions';
import { Text } from '@/components/ui/text';
import { RequireConnection, useHermesClient } from '@/contexts/connection-context';
import { useTheme } from '@/contexts/theme-context';
import { confirmAction } from '@/lib/confirm';
import {
  describeHermesError,
  formatPreview,
  formatSessionTime,
  sourceLabel,
  type HermesSession,
} from '@/lib/hermes';

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
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<HermesSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<HermesSession | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  function replaceSession(next: HermesSession) {
    setSessions((current) => {
      const list = (current ?? []).map((item) => (item.id === next.id ? next : item));
      return list.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      });
    });
    setMenu(next);
  }

  const load = useCallback(async () => {
    if (loaded.current) setRefreshing(true);
    try {
      const next = await client.listSessions();
      setSessions(next);
      setError(null);
      loaded.current = true;
    } catch (err) {
      setError(describeHermesError(err));
      setSessions((current) => current ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [client]);

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

  async function onTogglePin() {
    if (!menu) return;
    setBusy(true);
    try {
      const next = await client.patchSession(menu.id, { pinned: !menu.pinned });
      replaceSession(next);
      setMenu(null);
      setError(null);
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setBusy(false);
    }
  }

  function onFork() {
    if (!menu) return;
    const source = menu;
    const branch = () => {
      void (async () => {
        setBusy(true);
        try {
          const copy = await client.forkSession(source.id, `${source.title} (copia)`);
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
      title: 'Ramificar conversación',
      message: 'Ramificar cierra esta conversación en el servidor y abre una copia.',
      confirmLabel: 'Ramificar',
      onConfirm: branch,
    });
  }

  function onDelete() {
    if (!menu) return;
    const source = menu;
    const remove = () => {
      void (async () => {
        setBusy(true);
        try {
          await client.deleteSession(source.id);
          setSessions((current) => (current ?? []).filter((item) => item.id !== source.id));
          setMenu(null);
          setError(null);
        } catch (err) {
          setError(describeHermesError(err));
        } finally {
          setBusy(false);
        }
      })();
    };
    confirmAction({
      title: 'Borrar conversación',
      message: 'Se elimina del servidor.',
      confirmLabel: 'Borrar',
      destructive: true,
      onConfirm: remove,
    });
  }

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
      title="Conversaciones"
      headerRight={
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tareas programadas"
            hitSlop={8}
            onPress={() => router.push('/jobs')}
          >
            <CalendarDaysIcon color={t.fg} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajustes"
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
                void load();
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
            <Text style={[styles.empty, { color: t.mut }]}>Todavía no hay conversaciones.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              delayLongPress={350}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
              onLongPress={() => setMenu(item)}
              style={[styles.row, { borderBottomColor: t.bd }]}
            >
              <View style={styles.rowTop}>
                <Text style={[styles.title, { color: t.fg }]}>
                  {item.pinned ? '📌 ' : ''}
                  {item.title}
                </Text>
                <Text style={[styles.time, { color: t.mut }]}>{formatSessionTime(item.updatedAt)}</Text>
              </View>
              {sourceLabel(item.source) ? (
                <Text style={[styles.source, { color: t.mut }]}>{sourceLabel(item.source)}</Text>
              ) : null}
              {item.preview ? (
                <Text numberOfLines={2} style={[styles.preview, { color: t.mut }]}>
                  {formatPreview(item.preview)}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nueva conversación"
        disabled={creating}
        onPress={() => {
          void onCreate();
        }}
        style={[
          styles.fab,
          { backgroundColor: t.pri, opacity: creating ? 0.5 : 1, bottom: insets.bottom + 24 },
        ]}
      >
        {creating ? <ActivityIndicator color={t.pfg} /> : <PlusIcon color={t.pfg} size={28} />}
      </Pressable>
      <SessionActions
        session={menu}
        busy={busy}
        onClose={() => setMenu(null)}
        onRename={(title) => {
          void onRename(title);
        }}
        onTogglePin={() => {
          void onTogglePin();
        }}
        onFork={onFork}
        onDelete={onDelete}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { paddingVertical: 12, fontSize: 14, color: '#ef4444' },
  empty: { paddingVertical: 32 },
  row: { borderBottomWidth: 1, paddingVertical: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontWeight: '600' },
  time: { fontSize: 14 },
  source: { marginTop: 2, fontSize: 12 },
  preview: { marginTop: 4, fontSize: 14 },
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
