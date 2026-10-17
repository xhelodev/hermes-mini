import { FontAwesome5 } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  EnvelopeIcon,
  ShieldCheckIcon,
} from 'react-native-heroicons/outline';
import Animated, {
  FadeIn,
  interpolate,
  SlideInDown,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { feedbackMailto, SUPPORT_EMAIL } from '@/lib/support';

const DOCS_URL = 'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server';
const TAILSCALE_URL = 'https://play.google.com/store/apps/details?id=com.tailscale.ipn';
const SUPPORT_TELEGRAM = 'https://t.me/xhelodev';

/** Arrastre a partir del cual soltar cierra el sheet. */
const CLOSE_DISTANCE = 100;
/** Un tirón rápido hacia abajo cierra aunque no llegue a `CLOSE_DISTANCE`. */
const CLOSE_VELOCITY = 800;
const SPRING = { damping: 22, stiffness: 260, mass: 0.6 };
const OPEN_MS = 240;
const CLOSE_MS = 180;

/**
 * Sheet de ayuda de la pantalla de conexión. Es un overlay dentro de la misma
 * pantalla, no un `Modal`: en Android el Modal es otra ventana (un Dialog) y, si
 * se destruye con un dedo apoyado, React Native pierde el fin de ese toque y la
 * UI deja de responder. Renderizalo como hermano de `ScreenShell` para que cubra
 * también la cabecera.
 */
type ConnectionHelpSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function ConnectionHelpSheet({ visible, onClose }: ConnectionHelpSheetProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.help;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Desplazamiento del sheet por arrastre o salida. En reposo vale 0 (abierto):
  // la entrada la anima `entering` al montar. Si una animación arrancada en el
  // mismo commit del montaje se pierde, el sheet queda visible y no como una
  // capa invisible que se come los toques.
  const translateY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  // Traslación del dedo en el momento en que el contenido llegó arriba del todo.
  const dragStart = useSharedValue(0);
  // Mientras se cierra se ignoran los gestos, así nada interrumpe la salida.
  const closing = useSharedValue(false);

  const [closeRequested, setCloseRequested] = useState(false);

  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    closing.set(false);
    scrollY.set(0);
    translateY.set(0);
  }, [visible, closing, scrollY, translateY]);

  // onClose se llama con un timer en JS y no desde el callback de la animación,
  // que puede no dispararse si la animación se interrumpe.
  useEffect(() => {
    if (!closeRequested) return;
    closing.set(true);
    translateY.set(withTiming(height, { duration: CLOSE_MS }));
    const timer = setTimeout(() => {
      setCloseRequested(false);
      onClose();
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closeRequested, closing, height, onClose, translateY]);

  function close() {
    setCloseRequested(true);
  }

  // Atrás de Android cierra el sheet en vez de salir de la pantalla.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setCloseRequested(true);
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  // Arrastrar hacia abajo cierra el sheet: desde la cabecera, o desde el contenido
  // cuando está arriba del todo. Corre en el hilo de UI, junto con el scroll nativo.
  const gestures = useMemo(() => {
    const scroll = Gesture.Native();
    const pan = Gesture.Pan()
      .activeOffsetY(8)
      .failOffsetX([-16, 16])
      .simultaneousWithExternalGesture(scroll)
      .onBegin(() => {
        dragStart.set(0);
      })
      .onUpdate((event) => {
        if (closing.get()) return;
        if (scrollY.get() > 0) {
          dragStart.set(event.translationY);
          return;
        }
        translateY.set(Math.max(0, event.translationY - dragStart.get()));
      })
      .onEnd((event) => {
        if (closing.get()) return;
        const dy = translateY.get();
        if (dy > CLOSE_DISTANCE || (dy > 0 && event.velocityY > CLOSE_VELOCITY)) {
          closing.set(true);
          scheduleOnRN(setCloseRequested, true);
        } else {
          translateY.set(withSpring(0, SPRING));
        }
      });
    return { pan, scroll };
  }, [closing, dragStart, scrollY, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.get(), [0, height], [1, 0], 'clamp'),
  }));

  function open(url: string) {
    void Linking.openURL(url).catch(() => undefined);
  }

  if (!visible) return null;

  return (
    // Mientras sale deja pasar los toques a la pantalla de abajo.
    <View style={styles.root} pointerEvents={closeRequested ? 'none' : 'auto'}>
      <Animated.View
        pointerEvents="none"
        entering={FadeIn.duration(OPEN_MS)}
        style={styles.backdropWrap}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]} />
      </Animated.View>
      <Pressable accessibilityLabel={str.common.close} style={styles.dismiss} onPress={close} />
      <Animated.View entering={SlideInDown.duration(OPEN_MS)} style={styles.sheetWrap}>
        <GestureDetector gesture={gestures.pan}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 },
              sheetStyle,
            ]}
          >
            <View style={styles.drag}>
              <View style={[styles.handle, { backgroundColor: t.bd }]} />
              <Text style={[styles.title, { color: t.fg }]}>{str.connect.help}</Text>
            </View>
            <GestureDetector gesture={gestures.scroll}>
              <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                bounces={false}
                overScrollMode="never"
                scrollEventThrottle={16}
                onScroll={onScroll}
              >
                <Text style={[styles.body, { color: t.fg }]}>
                  {text.intro}
                </Text>
                <Text style={[styles.body, { color: t.fg }]}>
                  {text.guide}
                </Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => open(DOCS_URL)}
                  style={[styles.card, { borderColor: t.bd, backgroundColor: t.card }]}
                >
                  <BookOpenIcon color={t.pri} size={22} />
                  <View style={styles.cardText}>
                    <Text style={[styles.linkTitle, { color: t.pri }]}>{text.docs}</Text>
                    <Text style={[styles.linkSub, { color: t.mut }]}>
                      hermes-agent.nousresearch.com
                    </Text>
                  </View>
                  <ArrowTopRightOnSquareIcon color={t.mut} size={18} />
                </Pressable>

                <View style={styles.headingRow}>
                  <ShieldCheckIcon color={t.fg} size={20} />
                  <Text style={[styles.heading, styles.headingText, { color: t.fg }]}>
                    {text.vpnTitle}
                  </Text>
                </View>
                <Text style={[styles.body, { color: t.fg }]}>
                  {text.vpnBody}
                </Text>
                <Text style={[styles.body, { color: t.fg }]}>
                  {text.tailscale}
                </Text>
                <Pressable
                  accessibilityRole="link"
                  onPress={() => open(TAILSCALE_URL)}
                  style={[styles.card, { borderColor: t.bd, backgroundColor: t.card }]}
                >
                  <FontAwesome5 name="google-play" size={20} color={t.pri} />
                  <View style={styles.cardText}>
                    <Text style={[styles.linkTitle, { color: t.pri }]}>
                      {text.tailscaleLink}
                    </Text>
                    <Text style={[styles.linkSub, { color: t.mut }]}>
                      {text.tailscaleHint}
                    </Text>
                  </View>
                  <ArrowTopRightOnSquareIcon color={t.mut} size={18} />
                </Pressable>

                <Text style={[styles.heading, { color: t.fg }]}>{text.questions}</Text>
                <Text style={[styles.body, { color: t.fg }]}>{text.contact}</Text>
                <View style={styles.row}>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => open(feedbackMailto())}
                    style={[
                      styles.card,
                      styles.half,
                      { borderColor: t.bd, backgroundColor: t.card },
                    ]}
                  >
                    <EnvelopeIcon color={t.pri} size={22} />
                    <View style={styles.cardText}>
                      <Text style={[styles.linkTitle, { color: t.pri }]}>Email</Text>
                      <Text style={[styles.linkSub, { color: t.mut }]} numberOfLines={1}>
                        {SUPPORT_EMAIL}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => open(SUPPORT_TELEGRAM)}
                    style={[
                      styles.card,
                      styles.half,
                      { borderColor: t.bd, backgroundColor: t.card },
                    ]}
                  >
                    <FontAwesome5 name="telegram-plane" size={22} color={t.pri} />
                    <View style={styles.cardText}>
                      <Text style={[styles.linkTitle, { color: t.pri }]}>Telegram</Text>
                      <Text style={[styles.linkSub, { color: t.mut }]}>@xhelodev</Text>
                    </View>
                  </Pressable>
                </View>
              </Animated.ScrollView>
            </GestureDetector>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
    elevation: 10,
    justifyContent: 'flex-end',
  },
  backdropWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dismiss: { flex: 1 },
  sheetWrap: { maxHeight: '80%' },
  sheet: {
    flexShrink: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  drag: { paddingBottom: 4 },
  handle: {
    marginBottom: 12,
    height: 4,
    width: 40,
    alignSelf: 'center',
    borderRadius: 999,
  },
  title: { marginBottom: 12, fontSize: 18, fontWeight: '600' },
  heading: { marginBottom: 8, marginTop: 16, fontSize: 16, fontWeight: '600' },
  body: { marginBottom: 12, fontSize: 15, lineHeight: 22 },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  headingText: { marginTop: 0, marginBottom: 0 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cardText: { flex: 1 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  linkTitle: { fontSize: 15, fontWeight: '600' },
  linkSub: { marginTop: 2, fontSize: 13 },
});
