import { View } from 'react-native';

import { DevScreenLinks } from '@/components/dev-screen-links';
import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

const MODELS = [
  { name: 'DeepSeek V4 Pro', hint: 'por defecto', selected: true },
  { name: 'Grok', hint: 'xAI', selected: false },
  { name: 'Claude', hint: 'vía OpenRouter', selected: false },
  { name: 'GPT', hint: 'vía OpenRouter', selected: false },
];

export default function SelectorModeloScreen() {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <ScreenShell
      title="Modelo de esta conversación"
      subtitle="Lista traída de tu servidor (ejemplo)"
    >
      {MODELS.map((model) => (
        <View
          key={model.name}
          className="mb-2 flex-row items-center justify-between rounded-xl border p-3.5"
          style={{
            borderColor: t.bd,
            outlineWidth: model.selected ? 2 : 0,
            outlineColor: model.selected ? t.pri : 'transparent',
          }}
        >
          <View>
            <Text className="font-semibold" style={{ color: t.fg }}>
              {model.name}
            </Text>
            <Text className="text-sm" style={{ color: t.mut }}>
              {model.hint}
            </Text>
          </View>
          <Text style={{ color: t.fg }}>{model.selected ? '✓' : ''}</Text>
        </View>
      ))}
      <DevScreenLinks />
    </ScreenShell>
  );
}
