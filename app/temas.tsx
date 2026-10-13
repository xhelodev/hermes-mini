import { router } from 'expo-router';
import { useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  ChevronRightIcon,
  CpuChipIcon,
  LanguageIcon,
  PuzzlePieceIcon,
} from 'react-native-heroicons/outline';
import type { NumberProp, SvgProps } from 'react-native-svg';

import { ModelSheet } from '@/components/model-sheet';
import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { VoiceLocaleSheet } from '@/components/voice-locale-sheet';
import { RequireConnection, useConnection } from '@/contexts/connection-context';
import { useTheme } from '@/contexts/theme-context';
import { useVoiceLocale } from '@/contexts/voice-locale-context';
import { THEMES, type ThemeId } from '@/lib/themes';

function ThemePreviewCard({
  label,
  tokens,
  selected,
  labelColor,
  accent,
  onPress,
}: {
  label: string;
  tokens: (typeof THEMES)[number]['tokens'];
  selected: boolean;
  labelColor: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { borderColor: selected ? accent : tokens.bd, borderWidth: selected ? 2 : 1 }]}
    >
      <View style={[styles.preview, { backgroundColor: tokens.bg, borderColor: tokens.bd }]}>
        <View style={[styles.previewBar, { backgroundColor: tokens.pri }]} />
        <View style={[styles.previewLine, { backgroundColor: tokens.card }]} />
      </View>
      <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

type RowIcon = ComponentType<SvgProps & { size?: NumberProp }>;

function SettingsRow({
  icon: Icon,
  label,
  value,
  onPress,
}: {
  icon: RowIcon;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.modelRow, { borderColor: t.bd, backgroundColor: t.card }]}
    >
      <Icon color={t.fg} size={22} />
      <Text style={[styles.rowLabel, { color: t.fg }]}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} style={[styles.rowValue, { color: t.mut }]}>
          {value}
        </Text>
      ) : null}
      <ChevronRightIcon color={t.mut} size={18} />
    </Pressable>
  );
}

export default function TemasScreen() {
  return (
    <RequireConnection>
      <TemasBody />
    </RequireConnection>
  );
}

function TemasBody() {
  const { theme, themeId, setThemeId } = useTheme();
  const t = theme.tokens;
  const { defaultModel, clearConnection } = useConnection();
  const { label: voiceLabel } = useVoiceLocale();
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  return (
    <ScreenShell title="Ajustes" onBack={() => router.back()}>
      <View style={styles.grid}>
        {THEMES.map((item) => (
          <View key={item.id} style={styles.cell}>
            <ThemePreviewCard
              label={item.label}
              tokens={item.tokens}
              selected={themeId === item.id}
              labelColor={t.fg}
              accent={t.pri}
              onPress={() => setThemeId(item.id as ThemeId)}
            />
          </View>
        ))}
      </View>
      <SettingsRow
        icon={CpuChipIcon}
        label="Modelo por defecto"
        value={defaultModel?.label ?? 'El del servidor'}
        onPress={() => setModelsOpen(true)}
      />
      <SettingsRow
        icon={LanguageIcon}
        label="Idioma de voz"
        value={voiceLabel}
        onPress={() => setVoiceOpen(true)}
      />
      <SettingsRow
        icon={PuzzlePieceIcon}
        label="Skills y herramientas"
        onPress={() => router.push('/habilidades')}
      />
      <Text style={[styles.note, { color: t.mut }]}>
        El cambio es al instante. Paletas inspiradas en apps conocidas, sin sus logos.
      </Text>
      <Button
        style={styles.disconnect}
        label="Desconectar"
        variant="outline"
        borderColor={t.bd}
        textColor={t.fg}
        onPress={() => {
          void clearConnection().then(() => router.replace('/conexion'));
        }}
      />
      <ModelSheet
        visible={modelsOpen}
        title="Modelo por defecto"
        onClose={() => setModelsOpen(false)}
      />
      <VoiceLocaleSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { marginBottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%' },
  card: { borderRadius: 12, padding: 10 },
  preview: {
    marginBottom: 8,
    height: 88,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
  },
  previewBar: { marginBottom: 8, marginLeft: 'auto', height: 14, width: '60%', borderRadius: 4 },
  previewLine: { height: 14, width: '70%', borderRadius: 4 },
  cardLabel: { fontSize: 14 },
  modelRow: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 1, maxWidth: '46%', textAlign: 'right' },
  note: { fontSize: 14 },
  disconnect: { marginTop: 24 },
});
