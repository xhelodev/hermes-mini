# Hermes Go

Cliente de celular para Hermes. Se conecta a la API de Hermes Agent (Expo SDK 57, TypeScript).

## Desarrollo

```bash
npm install --legacy-peer-deps
npm start
```

## Calidad

```bash
npm run lint
npm run typecheck
npm test
```

## Build APK (EAS)

Perfil `preview` genera un APK (`buildType: apk`):

```bash
npx eas-cli build --profile preview --platform android
```

## Telemetría

`EXPO_NO_TELEMETRY=1` en `.env`, CI y perfil EAS `preview`. Sin `expo-updates`, `expo-insights` ni librerías de analíticas.

## Pantallas (expo-router)

Conexión, Conversaciones, Chat, Selector de modelo, Ajustes, Temas y Compartir — copys en español según el flujo de diseño.
