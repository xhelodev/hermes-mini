import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { PlusIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { BotScope, useBotScope, useScopedClient } from '@/contexts/bots-context';
import { RequireConnection } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { describeHermesError, formatPreview, HermesError, type HermesJob } from '@/lib/hermes';
import { stripRoutinePrefix } from '@/lib/bots';
import { describeSchedule, scheduleDetail } from '@/lib/schedule';

function oneParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function JobsScreen() {
  // Con `?bot=` son las rutinas de ese Bot: las tareas de su perfil.
  const params = useLocalSearchParams<{ bot?: string }>();
  return (
    <RequireConnection>
      <BotScope bot={oneParam(params.bot)}>
        <JobsBody />
      </BotScope>
    </RequireConnection>
  );
}

function JobsBody() {
  const client = useScopedClient();
  const bot = useBotScope();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.jobs;
  const insets = useSafeAreaInsets();
  const [jobs, setJobs] = useState<HermesJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    if (loaded.current) setRefreshing(true);
    try {
      const next = await client.listJobs();
      setJobs(next);
      setError(null);
      loaded.current = true;
    } catch (err) {
      setJobs((current) => current ?? []);
      setError(
        err instanceof HermesError && err.code === 'unavailable'
          ? text.unavailable
          : describeHermesError(err),
      );
    } finally {
      setRefreshing(false);
    }
  }, [client, text]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loading = jobs === null && !error;

  return (
    <ScreenShell scroll={false} title={bot ? str.bots.routinesOf(bot) : text.title} onBack={() => router.back()}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.pri} />
        </View>
      ) : (
        <FlatList
          data={jobs ?? []}
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
          ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            error ? null : <Text style={[styles.empty, { color: t.mut }]}>{text.empty}</Text>
          }
          renderItem={({ item }) => {
            const detail = scheduleDetail(item.schedule);
            return (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/jobs/[id]', params: bot ? { id: item.id, bot } : { id: item.id } })
                }
                style={[styles.row, { borderBottomColor: t.bd }]}
              >
                <View style={styles.rowTop}>
                  <Text style={[styles.title, { color: t.fg }]}>
                    {bot ? stripRoutinePrefix(bot, item.name) : item.name}
                  </Text>
                  {item.paused ? <Text style={[styles.time, { color: t.mut }]}>{text.paused}</Text> : null}
                </View>
                <Text style={[styles.preview, { color: t.mut }]}>{describeSchedule(item.schedule)}</Text>
                {detail ? <Text style={[styles.detail, { color: t.mut }]}>{detail}</Text> : null}
                {item.prompt ? (
                  <Text numberOfLines={2} style={[styles.preview, { color: t.mut }]}>
                    {formatPreview(item.prompt)}
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.newJob}
        onPress={() => router.push(bot ? { pathname: '/jobs/nueva', params: { bot } } : '/jobs/nueva')}
        style={[styles.fab, { backgroundColor: t.pri, bottom: insets.bottom + 24 }]}
      >
        <PlusIcon color={t.pfg} size={28} />
      </Pressable>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { paddingVertical: 12, fontSize: 14, color: '#ef4444' },
  empty: { paddingVertical: 32 },
  row: { borderBottomWidth: 1, paddingVertical: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontWeight: '600' },
  time: { fontSize: 14 },
  preview: { marginTop: 4, fontSize: 14 },
  detail: { marginTop: 2, fontSize: 12 },
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
