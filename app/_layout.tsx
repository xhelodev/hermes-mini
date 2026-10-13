import '../global.css';

import { Stack } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '@/contexts/theme-context';

function ThemedStack() {
  const { theme, hydrated } = useTheme();

  if (!hydrated) {
    return <View className="flex-1" style={{ backgroundColor: theme.tokens.bg }} />;
  }

  return (
    <View className="flex-1" style={{ backgroundColor: theme.tokens.bg }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.tokens.bg },
          animation: 'fade',
        }}
      />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
