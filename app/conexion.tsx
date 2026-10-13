import { router } from 'expo-router';
import { View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

export default function ConexionScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell
      title="Conectar con Hermes"
      subtitle="Configurá el servidor una sola vez"
    >
      <Field
        label="URL del servidor (Tailscale)"
        value="https://hermes.tail1234.ts.net"
        borderColor={t.bd}
        backgroundColor={t.bg}
        textColor={t.fg}
        mutedColor={t.mut}
      />
      <Field
        label="Clave de la API"
        value="••••••••••••••••"
        secureTextEntry
        borderColor={t.bd}
        backgroundColor={t.bg}
        textColor={t.fg}
        mutedColor={t.mut}
      />
      <View
        className="mb-4 rounded-xl border px-3 py-3"
        style={{ borderColor: t.bd }}
      >
        <Text className="text-sm" style={{ color: '#22c55e' }}>
          ● Conexión OK · Hermes v0.x · 120 ms
        </Text>
      </View>
      <Button
        label="Guardar y entrar"
        backgroundColor={t.pri}
        textColor={t.pfg}
        onPress={() => router.push('/conversaciones')}
      />
      <Text className="mt-3 text-sm" style={{ color: t.mut }}>
        La clave queda cifrada en este teléfono.
      </Text>
      <DevScreenLinks />
    </ScreenShell>
  );
}
