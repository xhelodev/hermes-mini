import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

const ROWS = [
  { title: 'Riesgos del contrato', preview: 'Veo 3 riesgos: renovación…', time: '22:04' },
  { title: 'Resumen de noticias BTC', preview: 'Listo, te dejo 5 titulares', time: '18:30' },
  { title: 'Deploy del juego', preview: 'El build pasó sin errores', time: 'Ayer' },
  { title: 'Ideas para el finde', preview: 'Te armé 3 planes', time: 'Dom' },
];

export default function ConversacionesScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell title="Conversaciones">
      {ROWS.map((row) => (
        <Pressable
          key={row.title}
          onPress={() => router.push('/chat')}
          className="border-b py-3.5"
          style={{ borderBottomColor: t.bd }}
        >
          <View className="flex-row items-start justify-between gap-2">
            <Text className="flex-1 text-base font-semibold" style={{ color: t.fg }}>
              {row.title}
            </Text>
            <Text className="text-sm" style={{ color: t.mut }}>
              {row.time}
            </Text>
          </View>
          <Text className="mt-1 text-sm" style={{ color: t.mut }}>
            {row.preview}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nueva conversación"
        onPress={() => router.push('/chat')}
        className="absolute bottom-6 right-4 h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: t.pri }}
      >
        <Text className="text-3xl" style={{ color: t.pfg }}>+</Text>
      </Pressable>
      <DevScreenLinks />
    </ScreenShell>
  );
}
