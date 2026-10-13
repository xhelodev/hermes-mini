import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon } from 'react-native-heroicons/outline';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

export type ReasoningNote = {
  id: string;
  kind: 'reasoning' | 'commentary' | 'tool';
  text: string;
  preview?: string;
};

function orderedNotes(notes: ReasoningNote[]): ReasoningNote[] {
  const visible = notes.filter((note) => note.text.trim() || note.preview?.trim());
  return [
    ...visible.filter((note) => note.kind === 'reasoning'),
    ...visible.filter((note) => note.kind === 'commentary'),
    ...visible.filter((note) => note.kind === 'tool'),
  ];
}

export function ReasoningFold({ notes }: { notes: ReasoningNote[] }) {
  const { theme } = useTheme();
  const color = theme.tokens.mut;
  const [open, setOpen] = useState(false);
  const items = orderedNotes(notes);
  if (items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Razonamiento"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.trigger}
      >
        {open ? (
          <ChevronDownIcon color={color} size={16} />
        ) : (
          <ChevronRightIcon color={color} size={16} />
        )}
        <Text style={[styles.label, { color }]}>Razonamiento</Text>
      </Pressable>
      {open
        ? items.map((note) => (
            <View key={note.id}>
              <Text selectable style={[styles.body, { color }]}>
                {note.kind === 'tool' ? `Usando ${note.text}` : note.text}
              </Text>
              {note.preview ? (
                <Text selectable style={[styles.preview, { color }]}>
                  {note.preview}
                </Text>
              ) : null}
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 6, paddingHorizontal: 4 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { fontSize: 14 },
  body: { fontSize: 14 },
  preview: { marginTop: 4, fontSize: 13 },
});
