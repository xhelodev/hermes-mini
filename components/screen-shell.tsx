import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ChevronLeftIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  headerRight?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
};

export function ScreenShell({
  title,
  subtitle,
  onBack,
  headerRight,
  scroll = true,
  children,
}: ScreenShellProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const t = theme.tokens;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.flex}>{children}</View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: t.bd }]}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Atrás"
            hitSlop={8}
            onPress={onBack}
          >
            <ChevronLeftIcon color={t.fg} size={24} />
          </Pressable>
        ) : null}
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: t.fg }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={[styles.subtitle, { color: t.mut }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {headerRight}
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
  },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { marginTop: 4, fontSize: 14 },
});
