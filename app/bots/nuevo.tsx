import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useBots } from '@/contexts/bots-context';
import { RequireConnection } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { normalizeBotName } from '@/lib/bots';
import { confirmAction } from '@/lib/confirm';
import { describeHermesError } from '@/lib/hermes';

function oneParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function BotFormScreen() {
  return (
    <RequireConnection>
      <BotForm />
    </RequireConnection>
  );
}

/** Agrega un Bot o, con `?name=`, edita su clave propia o lo quita de la app. */
function BotForm() {
  const params = useLocalSearchParams<{ name?: string }>();
  const editing = oneParam(params.name);
  const { check, saveBot, removeBot, hasOwnKey } = useBots();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.bots;
  const [name, setName] = useState(editing);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSave() {
    const bot = normalizeBotName(editing || name);
    if (!bot) {
      setMessage(text.invalidName);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // Sin clave escrita se prueba (y se conserva) la que ya tenga.
      const access = await check(bot, key || undefined);
      if (access === 'needs_key') {
        setMessage(text.needsKeyDetail);
        return;
      }
      if (access === 'missing') {
        setMessage(text.missingDetail);
        return;
      }
      await saveBot(bot, key || undefined);
      router.back();
    } catch (err) {
      setMessage(describeHermesError(err));
    } finally {
      setBusy(false);
    }
  }

  function onRemove() {
    confirmAction({
      title: text.removeTitle,
      message: text.removeMessage,
      confirmLabel: text.remove,
      destructive: true,
      onConfirm: () => {
        void removeBot(editing).then(() => router.back());
      },
    });
  }

  return (
    <ScreenShell title={editing || text.add} onBack={() => router.back()}>
      {editing ? null : (
        <Field
          label={text.name}
          value={name}
          onChangeText={setName}
          placeholder={text.namePlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          borderColor={t.bd}
          backgroundColor={t.card}
          textColor={t.fg}
          mutedColor={t.mut}
        />
      )}
      <Field
        label={text.key}
        value={key}
        onChangeText={setKey}
        placeholder={editing && hasOwnKey(editing) ? '••••••••' : text.keyPlaceholder}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        borderColor={t.bd}
        backgroundColor={t.card}
        textColor={t.fg}
        mutedColor={t.mut}
      />
      <Text style={[styles.hint, { color: t.mut }]}>{text.keyHint}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Button
        label={busy ? text.checking : text.save}
        backgroundColor={t.pri}
        textColor={t.pfg}
        disabled={busy}
        onPress={() => {
          void onSave();
        }}
      />
      {editing ? (
        <View style={styles.remove}>
          <Button
            label={text.remove}
            variant="outline"
            borderColor={t.bd}
            textColor="#ef4444"
            disabled={busy}
            onPress={onRemove}
          />
        </View>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, marginTop: -4, marginBottom: 16 },
  message: { color: '#ef4444', marginBottom: 12 },
  remove: { marginTop: 12 },
});
