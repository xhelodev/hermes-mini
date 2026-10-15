import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { elapsedLabel } from '@/lib/stream-progress';

type ThinkingRowProps = {
  label: string;
  color: string;
  /** Inicio de la espera (ms); si se pasa, la fila muestra el tiempo transcurrido. */
  since?: number;
};

export function ThinkingRow({ label, color, since }: ThinkingRowProps) {
  const elapsed = useElapsedLabel(since);
  return (
    <View style={styles.row}>
      <ThinkingDots color={color} />
      <Text style={[styles.label, { color }]}>{elapsed ? `${label} · ${elapsed}` : label}</Text>
    </View>
  );
}

/** Solo esta fila se vuelve a pintar cada segundo, no la lista ni el chat. */
function useElapsedLabel(since: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  return since === undefined ? null : elapsedLabel(now - since);
}

function ThinkingDots({ color }: { color: string }) {
  const [dots] = useState(() => [
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]);

  useEffect(() => {
    const loops = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 180),
          Animated.timing(dot, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.35, duration: 280, useNativeDriver: true }),
          Animated.delay((2 - index) * 180),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [dots]);

  return (
    <View style={styles.dots}>
      {dots.map((dot, index) => (
        <Animated.View key={index} style={[styles.dot, { backgroundColor: color, opacity: dot }]} />
      ))}
    </View>
  );
}

type StreamCursorProps = {
  color: string;
};

export function StreamCursor({ color }: StreamCursorProps) {
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(420),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.delay(220),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.cursor, { backgroundColor: color, opacity }]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cursor: { width: 2, height: 18, borderRadius: 1, marginTop: 2 },
});
