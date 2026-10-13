import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useConnection } from '@/contexts/connection-context';

export default function Index() {
  const { hydrated, isReady } = useConnection();
  if (!hydrated) return <View style={styles.flex} />;
  return <Redirect href={isReady ? '/conversaciones' : '/conexion'} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
