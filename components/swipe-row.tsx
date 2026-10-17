import { useMemo, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ArchiveBoxArrowDownIcon,
  ArchiveBoxXMarkIcon,
  MapPinIcon,
  PencilSquareIcon,
  Square2StackIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import type { NumberProp, SvgProps } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';
import { swipeActionLabel, type SwipeActionId } from '@/lib/swipe-actions';

type SwipeRowProps = {
  /** Acción al deslizar hacia la izquierda. */
  leftAction: SwipeActionId;
  /** Acción al deslizar hacia la derecha. */
  rightAction: SwipeActionId;
  pinned?: boolean;
  /** Dentro de las archivadas, «archivar» pasa a ser «desarchivar». */
  archived?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onAction: (action: SwipeActionId) => void;
  children: ReactNode;
};

type ActionIcon = ComponentType<SvgProps & { size?: NumberProp }>;

const ICONS: Record<Exclude<SwipeActionId, 'none'>, ActionIcon> = {
  delete: TrashIcon,
  archive: ArchiveBoxArrowDownIcon,
  pin: MapPinIcon,
  rename: PencilSquareIcon,
  fork: Square2StackIcon,
};

/** Distancia a partir de la cual soltar dispara la acción. */
const TRIGGER_DISTANCE = 72;
/** Un gesto rápido dispara la acción aunque no llegue a `TRIGGER_DISTANCE`. */
const FLING_VELOCITY = 600;
const FLING_MIN_DISTANCE = 32;
const SPRING = { damping: 22, stiffness: 260, mass: 0.6 };

export function SwipeRow({
  leftAction,
  rightAction,
  pinned = false,
  archived = false,
  disabled = false,
  style,
  onAction,
  children,
}: SwipeRowProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const translateX = useSharedValue(0);
  const canLeft = leftAction !== 'none';
  const canRight = rightAction !== 'none';

  // El gesto corre en el hilo de UI; solo vuelve a JS para ejecutar la acción al soltar.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && (canLeft || canRight))
        .activeOffsetX([-10, 10])
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
          const dx = event.translationX;
          translateX.set((dx < 0 && !canLeft) || (dx > 0 && !canRight) ? 0 : dx);
        })
        .onEnd((event) => {
          const dx = translateX.get();
          const flung =
            Math.abs(event.velocityX) > FLING_VELOCITY && Math.abs(dx) > FLING_MIN_DISTANCE;
          translateX.set(withSpring(0, SPRING));
          if (Math.abs(dx) < TRIGGER_DISTANCE && !flung) return;
          scheduleOnRN(onAction, dx < 0 ? leftAction : rightAction);
        })
        .onFinalize(() => {
          if (translateX.get() !== 0) translateX.set(withSpring(0, SPRING));
        }),
    [canLeft, canRight, disabled, leftAction, onAction, rightAction, translateX],
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  return (
    <View style={[styles.container, style]}>
      {/* Deslizar a la derecha descubre el panel de la izquierda, y viceversa. */}
      {rightAction !== 'none' ? (
        <ActionPanel
          action={rightAction}
          side="start"
          pinned={pinned}
          archived={archived}
          translateX={translateX}
        />
      ) : null}
      {leftAction !== 'none' ? (
        <ActionPanel
          action={leftAction}
          side="end"
          pinned={pinned}
          archived={archived}
          translateX={translateX}
        />
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ backgroundColor: t.bg }, contentStyle]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

function ActionPanel({
  action,
  side,
  pinned,
  archived,
  translateX,
}: {
  action: Exclude<SwipeActionId, 'none'>;
  side: 'start' | 'end';
  pinned: boolean;
  archived: boolean;
  translateX: SharedValue<number>;
}) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const Icon = action === 'archive' && archived ? ArchiveBoxXMarkIcon : ICONS[action];
  const colors =
    action === 'delete'
      ? { bg: '#ef4444', fg: '#ffffff' }
      : action === 'pin'
        ? { bg: t.pri, fg: t.pfg }
        : { bg: t.card, fg: t.fg };
  const sign = side === 'start' ? 1 : -1;

  const panelStyle = useAnimatedStyle(() => ({
    opacity: translateX.get() * sign > 0 ? 1 : 0,
  }));
  // El ícono crece al llegar al umbral, para avisar que soltar ya dispara la acción.
  const contentStyle = useAnimatedStyle(() => {
    const progress = Math.min(Math.max((translateX.get() * sign) / TRIGGER_DISTANCE, 0), 1);
    return {
      opacity: interpolate(progress, [0, 1], [0.5, 1]),
      transform: [{ scale: progress >= 1 ? 1.15 : interpolate(progress, [0, 1], [0.8, 1]) }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.panel,
        {
          backgroundColor: colors.bg,
          justifyContent: side === 'start' ? 'flex-start' : 'flex-end',
        },
        panelStyle,
      ]}
    >
      <Animated.View style={[styles.panelContent, contentStyle]}>
        <Icon color={colors.fg} size={22} />
        <Text style={[styles.panelLabel, { color: colors.fg }]}>
          {swipeActionLabel(action, pinned, archived)}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  panel: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  panelContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelLabel: { fontWeight: '600' },
});
