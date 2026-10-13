import Constants from 'expo-constants';

function defined(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type HermesExtra = {
  hermesUrl?: string;
  hermesApiKey?: string;
};

/** Credenciales de `.env`. Cadena vacía si la variable no está definida. */
export function envCredentials(): { baseUrl: string; apiKey: string } {
  const extra = Constants.expoConfig?.extra as HermesExtra | undefined;
  return {
    baseUrl: defined(extra?.hermesUrl) || defined(process.env.EXPO_PUBLIC_HERMES_URL),
    apiKey: defined(extra?.hermesApiKey) || defined(process.env.EXPO_PUBLIC_HERMES_API_KEY),
  };
}
