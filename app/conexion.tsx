import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useConnection } from '@/contexts/connection-context';
import { useTheme } from '@/contexts/theme-context';
import { envCredentials } from '@/lib/env';
import { useKeyboardInset } from '@/lib/keyboard-inset';
import { describeHermesError, HermesClient, HermesError, normalizeBaseUrl } from '@/lib/hermes';

export default function ConexionScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const { hydrated, baseUrl, apiKey, saveConnection } = useConnection();
  const fromEnv = envCredentials();
  const [url, setUrl] = useState(fromEnv.baseUrl);
  const [key, setKey] = useState(fromEnv.apiKey);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const seeded = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
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
        setMessage('Ingresá la clave de la API.');
        return;
      }
      const probe = await new HermesClient({ baseUrl: normalized, apiKey: key }).probe();
      await saveConnection(normalized, key);
      setOk(true);
      setMessage(`Conexión OK · Hermes · ${probe.latencyMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 450));
      if (alive.current) router.replace('/conversaciones');
    } catch (error) {
      setOk(false);
      setMessage(
        error instanceof HermesError
          ? describeHermesError(error)
          : 'No se pudo guardar la clave en este teléfono.',
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <ScreenShell title="Conectar con Hermes" scroll={false}>
      <View style={[styles.flex, { paddingBottom: keyboard.height }]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="URL del servidor"
            value={url}
            onChangeText={setUrl}
            placeholder="https://ejemplo.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            borderColor={t.bd}
            backgroundColor={t.card}
            textColor={t.fg}
            mutedColor={t.mut}
          />
          <Field
            label="Clave de la API"
            value={key}
            onChangeText={setKey}
            placeholder="tu clave"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            borderColor={t.bd}
            backgroundColor={t.card}
            textColor={t.fg}
            mutedColor={t.mut}
          />
          {message ? (
            <View style={[styles.message, { borderColor: t.bd, backgroundColor: t.card }]}>
              <Text style={[styles.messageText, { color: ok ? '#16a34a' : '#ef4444' }]}>
                {ok ? '● ' : ''}
                {message}
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View
          style={[
            styles.footer,
            { paddingBottom: keyboard.visible ? 12 : insets.bottom + 12 },
          ]}
        >
          <Button
            label={busy ? 'Probando…' : 'Guardar y entrar'}
            backgroundColor={t.pri}
            textColor={t.pfg}
            disabled={busy}
            onPress={() => {
              void onSave();
            }}
          />
          <Text style={[styles.hint, { color: t.mut }]}>La clave queda cifrada en este teléfono.</Text>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
  message: {
    marginBottom: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  messageText: { fontSize: 14 },
  hint: { marginTop: 12, fontSize: 14 },
});
