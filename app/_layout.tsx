import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConnectionProvider } from '@/contexts/connection-context';
import { ThemeProvider, useTheme } from '@/contexts/theme-context';
import { VoiceLocaleProvider } from '@/contexts/voice-locale-context';

function ThemedStack() {
  const { theme, hydrated } = useTheme();

  if (!hydrated) {
    return <View style={[styles.flex, { backgroundColor: theme.tokens.bg }]} />;
  }

  return (
    <View style={[styles.flex, { backgroundColor: theme.tokens.bg }]}>
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
        <VoiceLocaleProvider>
          <ConnectionProvider>
            <ThemedStack />
          </ConnectionProvider>
        </VoiceLocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
