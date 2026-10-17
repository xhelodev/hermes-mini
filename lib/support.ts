import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { strings } from '@/lib/i18n';

export const SUPPORT_EMAIL = 'hola@carpincho.dev';

/** mailto con asunto y datos técnicos básicos (sin URL del servidor ni contenido de chats). */
export function feedbackMailto(): string {
  const text = strings().feedback;
  const version = Constants.expoConfig?.version ?? text.unknownVersion;
  const subject = text.subject(version);
  const body = [
    text.whatHappened,
    '',
    '',
    text.steps,
    '',
    '',
    '---',
    `App: ${version}`,
    `${text.platform}: ${Platform.OS} ${Platform.Version}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
