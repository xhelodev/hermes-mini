import { ArchiveBoxIcon, ChevronRightIcon } from 'react-native-heroicons/outline';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';

/** Alto fijo: la lista lo usa para esconder la fila corriendo el scroll. */
export const ARCHIVE_ROW_HEIGHT = 64;

/** Entrada a la carpeta de archivadas, arriba de la lista de conversaciones. */
export function ArchiveRow({
  count,
  onLayout,
  onPress,
}: {
  count: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const text = useStrings().archive;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text.title}, ${text.count(count)}`}
      onLayout={onLayout}
      onPress={onPress}
      style={[styles.row, { borderBottomColor: t.bd }]}
    >
      <View style={[styles.icon, { backgroundColor: t.card }]}>
        <ArchiveBoxIcon color={t.mut} size={20} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.fg }]}>{text.title}</Text>
        <Text style={{ color: t.mut }}>{text.count(count)}</Text>
      </View>
      <ChevronRightIcon color={t.mut} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: ARCHIVE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  icon: { height: 40, width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  body: { flex: 1, gap: 2 },
  title: { fontWeight: '600' },
});
