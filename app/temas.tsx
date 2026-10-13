import { Pressable, View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';
import { THEMES, type ThemeId } from '@/lib/themes';

function ThemePreviewCard({
  label,
  tokens,
  selected,
  onPress,
}: {
  label: string;
  tokens: (typeof THEMES)[number]['tokens'];
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl border p-2.5"
      style={{
        borderColor: tokens.bd,
        outlineWidth: selected ? 2 : 0,
        outlineColor: selected ? tokens.pri : 'transparent',
      }}
    >
      <View
        className="mb-2 h-[70px] overflow-hidden rounded-lg border p-2"
        style={{ backgroundColor: tokens.bg, borderColor: tokens.bd }}
      >
        <View
          className="mb-2 ml-auto h-3.5 w-[60%] rounded"
          style={{ backgroundColor: tokens.pri }}
        />
        <View
          className="h-3.5 w-[70%] rounded"
          style={{ backgroundColor: tokens.card }}
        />
      </View>
      <Text className="text-sm" style={{ color: tokens.fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function TemasScreen() {
  const { theme, themeId, setThemeId } = useTheme();

  return (
    <ScreenShell title="Tema">
      <View className="mb-4 flex-row flex-wrap gap-3">
        {THEMES.map((item) => (
          <View key={item.id} className="w-[47%]">
            <ThemePreviewCard
              label={item.label}
              tokens={item.tokens}
              selected={themeId === item.id}
              onPress={() => setThemeId(item.id as ThemeId)}
            />
          </View>
        ))}
      </View>
      <Text className="text-sm" style={{ color: theme.tokens.mut }}>
        El cambio es al instante. Paletas inspiradas en apps conocidas, sin sus logos.
      </Text>
      <DevScreenLinks />
    </ScreenShell>
  );
}
