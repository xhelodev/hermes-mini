import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const SUPPORT_EMAIL = 'hola@carpincho.dev';

/** mailto con asunto y datos técnicos básicos (sin URL del servidor ni contenido de chats). */
export function feedbackMailto(): string {
  const version = Constants.expoConfig?.version ?? 'desconocida';
  const subject = `Hermes Mini ${version}: reporte / comentario`;
  const body = [
    '¿Qué pasó o qué querés sugerir?',
    '',
    '',
    'Pasos para reproducirlo (si es un bug):',
    '',
    '',
    '---',
    `App: ${version}`,
    `Plataforma: ${Platform.OS} ${Platform.Version}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
