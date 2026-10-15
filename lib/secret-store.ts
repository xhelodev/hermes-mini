import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore no existe en web: ahí la clave va al almacenamiento local. En iOS y Android
// un fallo de SecureStore se propaga para no dejar la clave sin cifrar.
const SECURE_STORE = Platform.OS !== 'web';

export async function readSecret(key: string): Promise<string | null> {
  if (!SECURE_STORE) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key).catch(() => null);
}

export async function writeSecret(key: string, value: string): Promise<void> {
  if (!SECURE_STORE) return AsyncStorage.setItem(key, value);
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (!SECURE_STORE) return AsyncStorage.removeItem(key);
  await SecureStore.deleteItemAsync(key).catch(() => undefined);
}
