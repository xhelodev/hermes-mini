import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

/** Parte del teclado que todavía tapa la ventana. 0 si el sistema ya encogió la vista. */
export function keyboardOverlap(windowHeight: number, screenY: number): number {
  if (!Number.isFinite(windowHeight) || !Number.isFinite(screenY)) return 0;
  return Math.max(0, Math.round(windowHeight - screenY));
}

/**
 * Alto a reservar debajo del contenido.
 * Toma el mayor entre el solapamiento, el alto del teclado y la distancia al borde
 * de la pantalla. Si la ventana ya se encogió con el teclado, no se suma de nuevo.
 */
export function keyboardInsetHeight(
  windowHeight: number,
  screenHeight: number,
  screenY: number,
  keyboardHeight: number,
): number {
  const overlap = keyboardOverlap(windowHeight, screenY);
  const reported = Number.isFinite(keyboardHeight) ? Math.max(0, Math.round(keyboardHeight)) : 0;
  const fromBottom =
    Number.isFinite(screenHeight) && Number.isFinite(screenY)
      ? Math.max(0, Math.round(screenHeight - screenY))
      : 0;
  const shrunk =
    Number.isFinite(screenHeight) && Number.isFinite(windowHeight)
      ? Math.max(0, Math.round(screenHeight - windowHeight))
      : 0;
  // Si la ventana ya se encogió casi todo el teclado, no sumar el alto otra vez.
  if (reported > 0 && shrunk >= reported * 0.75) return overlap;
  return Math.max(overlap, reported, fromBottom);
}

export function useKeyboardInset(): { height: number; visible: boolean } {
  const [height, setHeight] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;

    const apply = (event?: KeyboardEvent) => {
      const measure = () => {
        const metrics = event?.endCoordinates ?? Keyboard.metrics();
        if (!metrics || metrics.height <= 0) {
          setVisible(false);
          setHeight(0);
          return;
        }
        setVisible(true);
        const windowHeight = Dimensions.get('window').height;
        const screenHeight = Dimensions.get('screen').height;
        setHeight(
          keyboardInsetHeight(windowHeight, screenHeight, metrics.screenY, metrics.height),
        );
      };

      if (Platform.OS === 'ios') {
        if (event && event.duration > 10) {
          LayoutAnimation.configureNext({
            duration: event.duration,
            update: { type: 'keyboard', duration: event.duration },
          });
        }
        measure();
        return;
      }

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const subscriptions = [
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow',
        apply,
      ),
      Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
        setVisible(false);
        setHeight(0);
      }),
    ];
    const dimensions = Dimensions.addEventListener('change', () => apply());

    return () => {
      cancelAnimationFrame(frame);
      subscriptions.forEach((subscription) => subscription.remove());
      dimensions.remove();
    };
  }, []);

  return { height, visible };
}
