import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useConnection } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { checkConnection, useConnectionHealth, type HealthStatus } from '@/lib/connection-health';

const COLORS: Record<HealthStatus, string> = {
  online: '#22c55e',
  checking: '#eab308',
  offline: '#ef4444',
};

/**
 * Punto de color con el estado de la conexión a Hermes: verde conectado, amarillo
 * verificando, rojo sin conexión. Tocarlo vuelve a verificar y muestra el detalle.
 */
export function ConnectionDot() {
  const { client } = useConnection();
  const health = useConnectionHealth(client);
  const { theme } = useTheme();
  const t = theme.tokens;
  const text = useStrings().health;
  const [expanded, setExpanded] = useState(false);
  const [pulse] = useState(() => new Animated.Value(1));
  const color = COLORS[health.status];

  useEffect(() => {
    if (health.status !== 'checking') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [health.status, pulse]);

  // El detalle se esconde solo al rato para no ocupar el encabezado.
  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => setExpanded(false), 4000);
    return () => clearTimeout(id);
  }, [expanded, health.status]);

  const label = text[health.status];
  let detail = label;
  if (health.status === 'online' && health.latencyMs !== null) detail += ` · ${health.latencyMs} ms`;
  if (health.status === 'offline' && health.error) detail = health.error;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text.label(label)}
      accessibilityHint={text.hint}
      hitSlop={10}
      onPress={() => {
        setExpanded(true);
        void checkConnection(true);
      }}
      style={styles.row}
    >
      <View style={styles.dotBox}>
        <View style={[styles.halo, { backgroundColor: color }]} />
        <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      </View>
      {expanded ? (
        <Text numberOfLines={1} style={[styles.label, { color: t.mut }]}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dotBox: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 14, height: 14, borderRadius: 7, opacity: 0.25 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 12, flexShrink: 1 },
});
