import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyIcon, ServerIcon, XMarkIcon } from 'react-native-heroicons/outline';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { displayUrl, formatLastUsed, type ConnectionEntry } from '@/lib/connection-history';

type ConnectionHistoryProps = {
  entries: ConnectionEntry[];
  /** URL que está en el formulario, para marcar su fila. */
  selectedUrl: string | null;
  disabled: boolean;
  onSelect: (entry: ConnectionEntry) => void;
  onRemove: (entry: ConnectionEntry) => void;
  onClear: () => void;
};

export function ConnectionHistory({
  entries,
  selectedUrl,
  disabled,
  onSelect,
  onRemove,
  onClear,
}: ConnectionHistoryProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  // Fijo mientras la pantalla está abierta: alcanza para "hace 5 min".
  const [now] = useState(() => Date.now());
  if (entries.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.mut }]}>{str.history.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={str.history.clearLabel}
          disabled={disabled}
          onPress={onClear}
          hitSlop={8}
        >
          <Text style={[styles.clear, { color: t.pri }]}>{str.history.clear}</Text>
        </Pressable>
      </View>
      <View style={[styles.list, { borderColor: t.bd, backgroundColor: t.card }]}>
        {entries.map((entry, index) => {
          const selected = entry.baseUrl === selectedUrl;
          return (
            <View
              key={entry.id}
              style={[
                styles.row,
                index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd } : null,
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={str.history.use(displayUrl(entry.baseUrl))}
                accessibilityState={{ selected }}
                disabled={disabled}
                onPress={() => onSelect(entry)}
                style={styles.main}
              >
                <ServerIcon color={selected ? t.pri : t.mut} size={20} />
                <View style={styles.texts}>
                  <Text numberOfLines={1} style={[styles.url, { color: selected ? t.pri : t.fg }]}>
                    {displayUrl(entry.baseUrl)}
                  </Text>
                  <View style={styles.meta}>
                    <Text style={[styles.metaText, { color: t.mut }]}>
                      {formatLastUsed(entry.lastUsedAt, now)}
                    </Text>
                    {entry.hasKey ? (
                      <>
                        <Text style={[styles.metaText, { color: t.mut }]}>·</Text>
                        <KeyIcon color={t.mut} size={12} />
                        <Text style={[styles.metaText, { color: t.mut }]}>{str.history.keySaved}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={str.history.remove(displayUrl(entry.baseUrl))}
                disabled={disabled}
                onPress={() => onRemove(entry)}
                hitSlop={8}
                style={styles.remove}
              >
                <XMarkIcon color={t.mut} size={18} />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: { fontSize: 14 },
  clear: { fontSize: 14, fontWeight: '600' },
  list: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  texts: { flex: 1 },
  url: { fontSize: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 12 },
  remove: { paddingHorizontal: 12, paddingVertical: 14 },
});
