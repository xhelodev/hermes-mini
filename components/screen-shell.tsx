import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <View className="flex-1" style={{ backgroundColor: t.bg, paddingTop: insets.top }}>
      <View
        className="border-b px-4 pb-3 pt-2"
        style={{ borderBottomColor: t.bd }}
      >
        <Text className="text-xl font-semibold" style={{ color: t.fg }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-1 text-sm" style={{ color: t.mut }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}
