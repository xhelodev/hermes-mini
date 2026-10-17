import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CheckIcon, InformationCircleIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionHelpSheet } from '@/components/connection-help-sheet';
import { ConnectionHistory } from '@/components/connection-history';
import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useConnection } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { confirmAction } from '@/lib/confirm';
import {
  clearHistory,
  loadHistory,
  readEntryKey,
  recordConnection,
  removeEntry,
  type ConnectionEntry,
} from '@/lib/connection-history';
import { envCredentials } from '@/lib/env';
import { useKeyboardInset } from '@/lib/keyboard-inset';
import { describeHermesError, HermesClient, HermesError, normalizeBaseUrl } from '@/lib/hermes';

export default function ConexionScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.connect;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const { hydrated, baseUrl, apiKey, saveConnection } = useConnection();
  const fromEnv = envCredentials();
  const [url, setUrl] = useState(fromEnv.baseUrl);
  const [key, setKey] = useState(fromEnv.apiKey);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [history, setHistory] = useState<ConnectionEntry[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const seeded = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void loadHistory().then((list) => {
      if (alive.current) setHistory(list);
    });
  }, []);

  useEffect(() => {
    if (!hydrated || seeded.current) return;
    seeded.current = true;
    setUrl(fromEnv.baseUrl || baseUrl.trim());
    setKey(fromEnv.apiKey || apiKey.trim());
  }, [hydrated, baseUrl, apiKey, fromEnv.baseUrl, fromEnv.apiKey]);

  async function onSave() {
    setBusy(true);
    setOk(false);
    setMessage(null);
    try {
      const normalized = normalizeBaseUrl(url);
      if (!key.trim()) {
        setMessage(text.keyMissing);
        return;
      }
      const probe = await new HermesClient({ baseUrl: normalized, apiKey: key }).probe();
      await saveConnection(normalized, key, remember);
      // El historial es un extra: si falla, igual se entra.
      await recordConnection(normalized, key, remember).catch(() => undefined);
      setOk(true);
      setMessage(text.ok(probe.latencyMs));
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (alive.current) router.replace('/conversaciones');
    } catch (error) {
      setOk(false);
      setMessage(
        error instanceof HermesError
          ? describeHermesError(error)
          : text.saveFailed,
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function onPickEntry(entry: ConnectionEntry) {
    setMessage(null);
    setOk(false);
    setUrl(entry.baseUrl);
    const saved = await readEntryKey(entry);
    if (!alive.current) return;
    setKey(saved ?? '');
    if (saved) setRemember(true);
  }

  function onRemoveEntry(entry: ConnectionEntry) {
    void removeEntry(entry.id)
      .then((list) => {
        if (alive.current) setHistory(list);
      })
      .catch(() => undefined);
  }

  function onClearHistory() {
    confirmAction({
      title: str.history.clearTitle,
      message: str.history.clearMessage,
      confirmLabel: str.history.clear,
      destructive: true,
      onConfirm: () => {
        void clearHistory()
          .then(() => {
            if (alive.current) setHistory([]);
          })
          .catch(() => undefined);
      },
    });
  }

  let selectedUrl: string | null = null;
  try {
    selectedUrl = url.trim() ? normalizeBaseUrl(url) : null;
  } catch {
    selectedUrl = null;
  }

  return (
    <>
      <ScreenShell title={text.title} scroll={false}>
        <View style={[styles.flex, { paddingBottom: keyboard.height }]}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              label={text.url}
              value={url}
              onChangeText={setUrl}
              placeholder={text.urlPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              borderColor={t.bd}
              backgroundColor={t.card}
              textColor={t.fg}
              mutedColor={t.mut}
            />
            <Field
              label={text.key}
              value={key}
              onChangeText={setKey}
              placeholder={text.keyPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              borderColor={t.bd}
              backgroundColor={t.card}
              textColor={t.fg}
              mutedColor={t.mut}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: remember }}
              accessibilityLabel={text.remember}
              disabled={busy}
              onPress={() => setRemember((current) => !current)}
              style={styles.remember}
            >
              <View
                style={[
                  styles.box,
                  {
                    borderColor: remember ? t.pri : t.bd,
                    backgroundColor: remember ? t.pri : t.card,
                  },
                ]}
              >
                {remember ? <CheckIcon color={t.pfg} size={16} /> : null}
              </View>
              <Text style={{ color: t.fg }}>{text.remember}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={text.help}
              onPress={() => setHelpOpen(true)}
              hitSlop={8}
              style={styles.helpRow}
            >
              <InformationCircleIcon color={t.pri} size={20} />
              <Text style={[styles.help, { color: t.pri }]}>{text.help}</Text>
            </Pressable>
            {message ? (
              <View style={[styles.message, { borderColor: t.bd, backgroundColor: t.card }]}>
                <Text style={[styles.messageText, { color: ok ? '#16a34a' : '#ef4444' }]}>
                  {ok ? '● ' : ''}
                  {message}
                </Text>
              </View>
            ) : null}
            <ConnectionHistory
              entries={history}
              selectedUrl={selectedUrl}
              disabled={busy}
              onSelect={(entry) => {
                void onPickEntry(entry);
              }}
              onRemove={onRemoveEntry}
              onClear={onClearHistory}
            />
          </ScrollView>
          <View
            style={[styles.footer, { paddingBottom: keyboard.visible ? 12 : insets.bottom + 12 }]}
          >
            <Button
              label={busy ? text.testing : text.submit}
              backgroundColor={t.pri}
              textColor={t.pfg}
              disabled={busy}
              onPress={() => {
                void onSave();
              }}
            />
            <Text style={[styles.hint, { color: t.mut }]}>
              {remember
                ? text.keyEncrypted
                : text.keyNotSaved}
            </Text>
          </View>
        </View>
      </ScreenShell>
      <ConnectionHelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16 },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 16 },
  help: { fontSize: 14, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
  message: {
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  messageText: { fontSize: 14 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  box: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 6,
  },
  hint: { marginTop: 12, fontSize: 14 },
});
