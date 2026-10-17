import { Pressable, StyleSheet, View } from 'react-native';
import { CameraIcon, PhotoIcon } from 'react-native-heroicons/outline';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { formatElapsed } from '@/lib/format';

const ACTIONS = [
  { id: 'camera' as const, Icon: CameraIcon },
  { id: 'gallery' as const, Icon: PhotoIcon },
];

export type AttachAction = (typeof ACTIONS)[number]['id'];

type AttachSheetProps = {
  recording: boolean;
  holding: boolean;
  elapsed: number;
  transcript: string;
  onAction: (action: AttachAction) => void;
};

export function AttachSheet({ recording, holding, elapsed, transcript, onAction }: AttachSheetProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();

  return (
    <View style={[styles.sheet, { backgroundColor: t.card }]}>
      <View style={[styles.handle, { backgroundColor: t.bd }]} />
      <Text style={[styles.title, { color: t.fg }]}>{recording ? str.attach.dictation : str.attach.title}</Text>
      {recording ? null : (
        <View style={styles.grid}>
          {ACTIONS.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              onPress={() => onAction(action.id)}
              style={[styles.action, { borderColor: t.bd, backgroundColor: t.bg }]}
            >
              <action.Icon color={t.fg} size={22} />
              <Text style={{ color: t.fg }}>{str.attach[action.id]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {recording ? (
        <View style={[styles.recording, { borderColor: t.bd, backgroundColor: t.bg }]}>
          <Text style={{ color: t.fg }}>● {str.attach.dictating} · {formatElapsed(elapsed)}</Text>
          {transcript ? <Text style={{ color: t.fg }}>{transcript}</Text> : null}
          <Text style={[styles.hint, { color: t.mut }]}>
            {holding ? str.attach.releaseToSend : str.attach.sending}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 12 },
  handle: { marginBottom: 12, height: 4, width: 40, alignSelf: 'center', borderRadius: 999 },
  title: { marginBottom: 12, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: {
    minHeight: 52,
    flexGrow: 1,
    flexBasis: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
  },
  recording: { marginTop: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  hint: { marginTop: 4, fontSize: 14 },
});
