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

## Build Android (EAS)

Perfil `preview` genera un APK (`buildType: apk`, distribución internal) para instalar a mano. Perfil `production` genera un AAB (`buildType: app-bundle`) para Play Store. El AAB no se instala directo en el teléfono.

### Nube

Compila en los servidores de EAS. Hace falta cuenta de Expo; no hace falta Android SDK en la máquina.

```bash
npx eas-cli build --profile preview --platform android
npx eas-cli build --profile production --platform android
```

### Local

Compila en esta PC. Hace falta Android SDK y JDK. Las credenciales siguen saliendo de EAS (`credentials source: remote`). La primera build de `production` crea el keystore de subida y lo guarda en EAS; esa clave firma las actualizaciones de `dev.carpincho.hermesgo`.

En Nobara `/tmp` es un tmpfs de ~7,7 GB (el 50% de los 15 GB de RAM), no el SSD. El build local copia el proyecto ahí y, al compilar nativo, llena esa RAM aunque el disco tenga cientos de GB libres. El error es `No space left on device` en una tarea de Gradle (`react-native-gesture-handler` / CMake). Agrandar el tmpfs empuja el build a swap y puede congelar el escritorio.

Hay que apuntar el temporal al disco:

```bash
mkdir -p "$HOME/tmp"
TMPDIR=$HOME/tmp npx eas-cli build --local --profile preview --platform android
TMPDIR=$HOME/tmp npx eas-cli build --local --profile production --platform android
```

Cada build local deja varios GB en `~/tmp`; se pueden borrar cuando el APK o el AAB ya está generado. El CLI imprime la ruta del binario al terminar. `*.apk` y `*.aab` están en `.gitignore`.

Durante el build son normales los avisos `deprecated` de `react-native-reanimated` y `Hard link ... failed. Doing a slower copy instead.` (el caché de Gradle está en `/home` y el build en otro sistema de archivos). No tumban la compilación.

## Telemetría

`EXPO_NO_TELEMETRY=1` en `.env`, CI y los perfiles EAS `preview` y `production`. Sin `expo-updates`, `expo-insights` ni librerías de analíticas.

## Pantallas (expo-router)

Conexión, Conversaciones, Chat, Selector de modelo, Ajustes, Temas y Compartir — copys en español según el flujo de diseño.
