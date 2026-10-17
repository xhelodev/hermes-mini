import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { CalendarDaysIcon, Cog6ToothIcon, PlusIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useBots, type BotAccess } from '@/contexts/bots-context';
import { RequireConnection } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { describeHermesError } from '@/lib/hermes';

type Status = BotAccess | 'checking' | { error: string };

export default function BotsScreen() {
  return (
    <RequireConnection>
      <BotsBody />
    </RequireConnection>
  );
}

function BotsBody() {
  const { bots, hydrated, hasOwnKey, check, clientFor } = useBots();
  const { theme } = useTheme();
  const t = theme.tokens;
  const text = useStrings().bots;
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Al volver a la pantalla se prueba cada Bot: la clave pudo cambiar en el servidor.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      for (const bot of bots) {
        setStatus((current) => ({ ...current, [bot]: current[bot] ?? 'checking' }));
        void check(bot)
          .catch((err: unknown) => ({ error: describeHermesError(err) }))
          .then((next) => {
            if (!cancelled) setStatus((current) => ({ ...current, [bot]: next }));
          });
      }
      return () => {
        cancelled = true;
      };
    }, [bots, check]),
  );

  function label(bot: string): string {
    const value = status[bot];
    if (value === undefined || value === 'checking') return text.checking;
    if (value === 'ok') return hasOwnKey(bot) ? text.ownKey : text.ready;
    if (value === 'needs_key') return text.needsKey;
    if (value === 'missing') return text.missing;
    return value.error;
  }

  async function open(bot: string) {
    const value = status[bot];
    if (value === 'needs_key' || value === 'missing') {
      router.push({ pathname: '/bots/nuevo', params: { name: bot } });
      return;
    }
    const client = clientFor(bot);
    if (!client || opening) return;
    setOpening(bot);
    setError(null);
    try {
      const chat = await client.openBotChat();
      router.push({ pathname: '/chat/[id]', params: { id: chat.id, bot } });
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setOpening(null);
    }
  }

  return (
    <ScreenShell scroll={false} title={text.title} onBack={() => router.back()}>
      {!hydrated ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.pri} />
        </View>
      ) : (
        <FlatList
          data={bots}
          keyExtractor={(item) => item}
          style={styles.flex}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 96, flexGrow: 1 }}
          ListHeaderComponent={
            <View>
              <Text style={[styles.intro, { color: t.mut }]}>{text.intro}</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
          ListEmptyComponent={<Text style={[styles.empty, { color: t.mut }]}>{text.empty}</Text>}
          renderItem={({ item }) => {
            const value = status[item];
            const blocked = value === 'needs_key' || value === 'missing';
            return (
              <View style={[styles.row, { borderBottomColor: t.bd }]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={opening !== null}
                  onPress={() => {
                    void open(item);
                  }}
                  style={styles.flex}
                >
                  <Text style={[styles.title, { color: t.fg }]}>{item}</Text>
                  <Text style={[styles.status, { color: blocked ? '#ef4444' : t.mut }]}>{label(item)}</Text>
                </Pressable>
                {opening === item ? <ActivityIndicator color={t.pri} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={text.routinesOf(item)}
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/jobs', params: { bot: item } })}
                >
                  <CalendarDaysIcon color={t.fg} size={22} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={text.settings(item)}
                  hitSlop={8}
                  onPress={() => router.push({ pathname: '/bots/nuevo', params: { name: item } })}
                >
                  <Cog6ToothIcon color={t.fg} size={22} />
                </Pressable>
              </View>
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.add}
        onPress={() => router.push('/bots/nuevo')}
        style={[styles.fab, { backgroundColor: t.pri, bottom: insets.bottom + 24 }]}
      >
        <PlusIcon color={t.pfg} size={28} />
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { fontSize: 14, paddingVertical: 12 },
  empty: { paddingVertical: 24, textAlign: 'center' },
  error: { color: '#ef4444', paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '600' },
  status: { fontSize: 14, marginTop: 2 },
  fab: {
    position: 'absolute',
    right: 24,
    height: 56,
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
  },
});
