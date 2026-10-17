import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CheckIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { useVoiceLocale } from '@/contexts/voice-locale-context';
import { VOICE_LOCALES, type VoiceLocaleId } from '@/lib/voice-locale';

type VoiceLocaleSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function VoiceLocaleSheet({ visible, onClose }: VoiceLocaleSheetProps) {
  const { locale, setLocale } = useVoiceLocale();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const insets = useSafeAreaInsets();

  function choose(id: VoiceLocaleId) {
    setLocale(id);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={str.common.close} style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.handle, { backgroundColor: t.bd }]} />
          <Text style={[styles.title, { color: t.fg }]}>{str.settings.voiceLanguage}</Text>
          <Text style={[styles.subtitle, { color: t.mut }]}>
            {str.settings.voiceHint}
          </Text>
          <ScrollView>
            {VOICE_LOCALES.map((item) => {
              const active = locale === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => choose(item.id)}
                  style={[
                    styles.option,
                    { borderColor: active ? t.pri : t.bd, backgroundColor: t.card },
                  ]}
                >
                  <Text style={[styles.optionLabel, { color: t.fg }]}>{item.label}</Text>
                  {active ? <CheckIcon color={t.fg} size={20} /> : null}
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
