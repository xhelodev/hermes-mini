import { View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

const MENU = [
  '↗ Compartir a otra app',
  '⧉ Copiar texto',
  '↻ Reintentar respuesta',
  '📌 Fijar',
];

const TARGETS = ['WhatsApp', 'Gmail', 'Notion', 'Más'];

export default function CompartirScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell
      title="Compartir"
      subtitle="Mantener presionado un mensaje (placeholder)"
    >
      <View
        className="mb-4 overflow-hidden rounded-xl border"
        style={{ borderColor: t.bd, backgroundColor: t.card }}
      >
        {MENU.map((item, index) => (
          <View
            key={item}
            className="px-3.5 py-3"
            style={{
              borderBottomWidth: index < MENU.length - 1 ? 1 : 0,
              borderBottomColor: t.bd,
            }}
          >
            <Text className="text-base" style={{ color: t.fg }}>{item}</Text>
          </View>
        ))}
      </View>
      <View className="flex-row justify-between">
        {TARGETS.map((target) => (
          <View key={target} className="items-center">
            <View
              className="mb-1.5 h-12 w-12 rounded-full"
              style={{ backgroundColor: t.bd }}
            />
            <Text className="text-xs text-center" style={{ color: t.mut }}>
              {target}
            </Text>
          </View>
        ))}
      </View>
      <DevScreenLinks />
    </ScreenShell>
  );
}
