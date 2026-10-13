import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { ArrowPathIcon, ArrowUpOnSquareIcon, ClipboardDocumentIcon } from 'react-native-heroicons/outline';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

type MessageActionsProps = {
  visible: boolean;
  onClose: () => void;
  onShare: () => void;
  onCopy: () => void;
  onRetry: () => void;
};

export function MessageActions({ visible, onClose, onShare, onCopy, onRetry }: MessageActionsProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const items = [
    { label: 'Compartir a otra app', Icon: ArrowUpOnSquareIcon, onPress: onShare },
    { label: 'Copiar texto', Icon: ClipboardDocumentIcon, onPress: onCopy },
    { label: 'Reintentar respuesta', Icon: ArrowPathIcon, onPress: onRetry },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
        <Pressable accessibilityLabel="Cerrar" style={styles.dismiss} onPress={onClose} />
        <View style={[styles.menu, { backgroundColor: t.card }]}>
          {items.map((item, index) => (
            <Pressable
              key={item.label}
              onPress={item.onPress}
              style={[styles.item, index === 0 ? null : { borderTopWidth: 1, borderTopColor: t.bd }]}
            >
              <item.Icon color={t.fg} size={20} />
              <Text style={{ color: t.fg }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  menu: { marginHorizontal: 16, marginBottom: 24, overflow: 'hidden', borderRadius: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
});
