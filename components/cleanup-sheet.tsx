import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { CLEANUP_AGES, type CleanupAge } from '@/lib/session-cleanup';

type CleanupSheetProps = {
  visible: boolean;
  /** Cuántas conversaciones borra cada opción. */
  counts: Record<CleanupAge, number>;
  onChoose: (days: CleanupAge) => void;
  onClose: () => void;
};

/** Opciones para borrar de una vez las conversaciones viejas. */
export function CleanupSheet({ visible, counts, onChoose, onClose }: CleanupSheetProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.cleanup;
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={str.common.close} style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.handle, { backgroundColor: t.bd }]} />
          <Text style={[styles.title, { color: t.fg }]}>{text.title}</Text>
          <Text style={[styles.subtitle, { color: t.mut }]}>{text.subtitle}</Text>
          <ScrollView>
            {CLEANUP_AGES.map((days) => {
              const count = counts[days];
              const empty = count === 0;
              return (
                <Pressable
                  key={days}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: empty }}
                  disabled={empty}
                  onPress={() => onChoose(days)}
                  style={[
                    styles.option,
                    { borderColor: t.bd, backgroundColor: t.card, opacity: empty ? 0.5 : 1 },
                  ]}
                >
                  <Text style={[styles.optionLabel, { color: t.fg }]}>{text.olderThan[days]}</Text>
                  <Text style={{ color: t.mut }}>{text.count(count)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  handle: { marginBottom: 12, height: 4, width: 40, alignSelf: 'center', borderRadius: 999 },
  title: { fontSize: 18, fontWeight: '600' },
  subtitle: { marginBottom: 12, marginTop: 4, fontSize: 14 },
  option: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionLabel: { flex: 1, paddingRight: 12, fontWeight: '600' },
});
