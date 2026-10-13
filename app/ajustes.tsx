import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

export default function AjustesScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell title="Ajustes">
      <Pressable
        onPress={() => router.push('/temas')}
        className="mb-3 flex-row items-center justify-between rounded-xl border p-3.5"
        style={{ borderColor: t.bd, backgroundColor: t.card }}
      >
        <Text style={{ color: t.fg }}>Tema de la app</Text>
        <Text style={{ color: t.mut }}>{theme.label} ›</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/selector-modelo')}
        className="mb-3 flex-row items-center justify-between rounded-xl border p-3.5"
        style={{ borderColor: t.bd, backgroundColor: t.card }}
      >
        <Text style={{ color: t.fg }}>Modelo por defecto</Text>
        <Text style={{ color: t.mut }}>DeepSeek V4 Pro ›</Text>
      </Pressable>
      <View
        className="rounded-xl border p-3.5"
        style={{ borderColor: t.bd, backgroundColor: t.card }}
      >
        <Text className="text-sm" style={{ color: t.mut }}>
          Sin telemetría: esta build no envía analíticas ni usa expo-updates.
        </Text>
      </View>
      <DevScreenLinks />
    </ScreenShell>
  );
}
