import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmHost } from '@/components/confirm-host';
import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import type { HermesSession } from '@/lib/hermes';

type SessionActionsProps = {
  session: HermesSession | null;
  /** Abre el menú directamente en el formulario de renombrar. */
  startRenaming?: boolean;
  busy: boolean;
  onClose: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onFork: () => void;
  onDelete: () => void;
};

export function SessionActions(props: SessionActionsProps) {
  return (
    <Modal visible={props.session !== null} transparent animationType="fade" onRequestClose={props.onClose}>
      {props.session ? <SessionMenu key={props.session.id} {...props} session={props.session} /> : null}
      <ConfirmHost />
    </Modal>
  );
}

function SessionMenu({
  session,
  startRenaming = false,
  busy,
  onClose,
  onRename,
  onTogglePin,
  onFork,
  onDelete,
}: SessionActionsProps & { session: HermesSession }) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const insets = useSafeAreaInsets();
  const [renaming, setRenaming] = useState(startRenaming);
  const [title, setTitle] = useState(session.title);
  const str = useStrings();
  const text = str.sessionMenu;
  const items = [
    { label: str.swipe.actions.rename, onPress: () => setRenaming(true) },
    { label: session.pinned ? text.unpin : text.pin, onPress: onTogglePin },
    { label: str.swipe.actions.fork, onPress: onFork },
    { label: str.common.delete, onPress: onDelete },
  ];

  return (
    <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
      <Pressable accessibilityLabel={str.common.close} style={styles.dismiss} onPress={onClose} />
      <View style={[styles.menu, { backgroundColor: t.card, marginBottom: insets.bottom + 16 }]}>
        {renaming ? (
          <View style={styles.rename}>
            <Text style={{ color: t.fg }}>{text.newTitle}</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              autoFocus
              placeholder={text.titlePlaceholder}
              placeholderTextColor={t.mut}
              style={[styles.input, { borderColor: t.bd, color: t.fg }]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !title.trim()}
              onPress={() => onRename(title.trim())}
              style={{ opacity: busy || !title.trim() ? 0.5 : 1 }}
            >
              <Text style={{ color: t.fg }}>{busy ? str.jobs.saving : str.jobs.save}</Text>
            </Pressable>
          </View>
        ) : (
          items.map((item, index) => (
            <Pressable
              key={item.label}
              disabled={busy}
              onPress={item.onPress}
              style={[
                styles.item,
                index === 0 ? null : { borderTopWidth: 1, borderTopColor: t.bd },
                { opacity: busy ? 0.5 : 1 },
              ]}
            >
              <Text style={{ color: item.label === 'Borrar' ? '#ef4444' : t.fg }}>{item.label}</Text>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  menu: { marginHorizontal: 16, overflow: 'hidden', borderRadius: 16 },
  item: { paddingHorizontal: 16, paddingVertical: 14 },
  rename: { gap: 12, padding: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
});
