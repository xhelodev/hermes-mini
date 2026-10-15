import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmHost } from '@/components/confirm-host';
import { ConnectionProvider } from '@/contexts/connection-context';
import { SwipeActionsProvider } from '@/contexts/swipe-actions-context';
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
      <ConfirmHost />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <ThemeProvider>
          <VoiceLocaleProvider>
            <SwipeActionsProvider>
              <ConnectionProvider>
                <ThemedStack />
              </ConnectionProvider>
            </SwipeActionsProvider>
          </VoiceLocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
