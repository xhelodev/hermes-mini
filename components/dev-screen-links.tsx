import { Link } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

const ROUTES: { href: string; label: string }[] = [
  { href: '/conexion', label: 'Conexión' },
  { href: '/conversaciones', label: 'Conversaciones' },
  { href: '/chat', label: 'Chat' },
  { href: '/selector-modelo', label: 'Selector de modelo' },
  { href: '/ajustes', label: 'Ajustes' },
  { href: '/temas', label: 'Temas' },
  { href: '/compartir', label: 'Compartir' },
];

export function DevScreenLinks() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <View
      className="mt-8 rounded-xl border p-3"
      style={{ borderColor: t.bd, backgroundColor: t.card }}
    >
      <Text className="mb-2 text-sm font-medium" style={{ color: t.mut }}>
        Navegación de pantallas (placeholder)
      </Text>
      {ROUTES.map((route) => (
        <Link key={route.href} href={route.href}>
          <Text className="py-1.5 text-base" style={{ color: t.pri }}>
            {route.label}
          </Text>
        </Link>
      ))}
    </View>
  );
}
