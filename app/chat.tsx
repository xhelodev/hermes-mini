import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

export default function ChatScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell title="Riesgos del contrato">
      <Pressable
        onPress={() => router.push('/selector-modelo')}
        className="mb-4 self-end rounded-full border px-3 py-1.5"
        style={{ borderColor: t.bd }}
      >
        <Text className="text-sm" style={{ color: t.fg }}>
          DeepSeek V4 Pro ▾
        </Text>
      </Pressable>

      <View className="gap-3">
        <View
          className="max-w-[85%] self-end rounded-xl px-3.5 py-2.5"
          style={{ backgroundColor: t.pri }}
        >
          <Text style={{ color: t.pfg }}>
            Resumime este PDF y decime qué riesgos ves
          </Text>
        </View>
        <View
          className="max-w-[85%] self-end rounded-xl border px-3 py-2"
          style={{ borderColor: t.bd }}
        >
          <Text className="text-sm" style={{ color: t.mut }}>
            📄 contrato-v2.pdf · 1,2 MB
          </Text>
        </View>
        <View
          className="max-w-[90%] self-start rounded-xl border px-3.5 py-3"
          style={{ backgroundColor: t.card, borderColor: t.bd }}
        >
          <Text style={{ color: t.fg }}>
            Son 12 páginas. Veo 3 riesgos: renovación automática, multa del 20 % y
            jurisdicción fuera de Perú.
          </Text>
        </View>
      </View>

      <View
        className="mt-6 flex-row items-center gap-2 rounded-xl border p-2"
        style={{ borderColor: t.bd }}
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-xl border"
          style={{ borderColor: t.bd }}
        >
          <Text style={{ color: t.fg }}>+</Text>
        </View>
        <Text className="flex-1 px-2" style={{ color: t.mut }}>
          Escribí un mensaje…
        </Text>
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: t.pri }}
        >
          <Text style={{ color: t.pfg }}>🎙</Text>
        </View>
      </View>

      <DevScreenLinks />
    </ScreenShell>
  );
}
