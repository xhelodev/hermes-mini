import { useEffect, useState, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import {
  getPendingConfirm,
  getTopConfirmHost,
  registerConfirmHost,
  resolveConfirm,
  subscribeConfirm,
} from '@/lib/confirm';

const DESTRUCTIVE = '#ef4444';

/**
 * Dibuja el diálogo de `confirmAction` como capa sobre su contenedor. Montarlo en la raíz y
 * dentro de cada `Modal` desde el que se pida confirmación.
 */
export function ConfirmHost() {
  const [id] = useState(() => Symbol('confirm-host'));
  const pending = useSyncExternalStore(subscribeConfirm, getPendingConfirm);
  const top = useSyncExternalStore(subscribeConfirm, getTopConfirmHost);
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();

  useEffect(() => registerConfirmHost(id), [id]);

  const visible = pending !== null && top === id;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      resolveConfirm(false);
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  if (!visible || !pending) return null;

  return (
    <View style={styles.backdrop}>
      <Pressable accessibilityLabel={str.common.cancel} style={StyleSheet.absoluteFill} onPress={() => resolveConfirm(false)} />
      <View
        accessibilityRole="alert"
        style={[styles.dialog, { backgroundColor: t.bg, borderColor: t.bd }]}
      >
        <Text style={[styles.title, { color: t.fg }]}>{pending.title}</Text>
        <Text style={[styles.message, { color: t.mut }]}>{pending.message}</Text>
        <View style={styles.actions}>
          <Button
            label={str.common.cancel}
            variant="outline"
            borderColor={t.bd}
            textColor={t.fg}
            style={styles.action}
            onPress={() => resolveConfirm(false)}
          />
          <Button
            label={pending.confirmLabel}
            backgroundColor={pending.destructive ? DESTRUCTIVE : t.pri}
            textColor={pending.destructive ? '#ffffff' : t.pfg}
            style={styles.action}
            onPress={() => resolveConfirm(true)}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: '600' },
  message: { marginTop: 8, fontSize: 15, lineHeight: 21 },
  actions: { marginTop: 20, flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
