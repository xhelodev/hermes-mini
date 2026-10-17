# Hermes Mini

Cliente de celular para Hermes. Se conecta a la API de Hermes Agent (Expo SDK 57, TypeScript).

## Desarrollo

```bash
npm install --legacy-peer-deps
npm start
```

## Idiomas

La app toma el idioma del teléfono (`expo-localization`): español o inglés, y cae en inglés si el teléfono está en otro idioma. El idioma de dictado arranca con la variante del teléfono hasta que se elige otro en Ajustes.

Los textos están en `lib/i18n/es.ts` (fuente de verdad) y `lib/i18n/en.ts`. En componentes se leen con `useStrings()`; fuera de React, con `strings()`. Un test verifica que los dos idiomas tengan las mismas claves. Los permisos de iOS se traducen en `locales/*.json`.

## Calidad

```bash
npm run lint
npm run typecheck
npm test
```

## Build Android (EAS)

El perfil decide el binario. `--local` no lo cambia.

| Perfil | Binario | Para qué |
| --- | --- | --- |
| `preview` | APK (`buildType: apk`) | Instalar a mano en el teléfono |
| `production` | AAB (`buildType: app-bundle`) | Subir a Play Store |

Un build con `--profile preview` siempre escribe `build-*.apk`, aunque la intención sea Play Store. El AAB no se instala directo en el teléfono.

### Nube

Compila en los servidores de EAS. Hace falta cuenta de Expo; no hace falta Android SDK en la máquina.

APK:

```bash
npx eas-cli build --profile preview --platform android
```

AAB:

```bash
npx eas-cli build --profile production --platform android
```

### Local

Compila en esta PC. Hace falta Android SDK y JDK. Las credenciales siguen saliendo de EAS (`credentials source: remote`). La primera build de `production` crea el keystore de subida y lo guarda en EAS; esa clave firma las actualizaciones de `dev.carpincho.hermesmini`.

En Nobara `/tmp` es un tmpfs de ~7,7 GB (el 50% de los 15 GB de RAM), no el SSD. El build local copia el proyecto ahí y, al compilar nativo, llena esa RAM aunque el disco tenga cientos de GB libres. El error es `No space left on device` en una tarea de Gradle (`react-native-gesture-handler` / CMake). Agrandar el tmpfs empuja el build a swap y puede congelar el escritorio.

Hay que apuntar el temporal al disco.

APK:

```bash
mkdir -p "$HOME/tmp"
TMPDIR=$HOME/tmp npx eas-cli build --local --profile preview --platform android
```

AAB:

```bash
mkdir -p "$HOME/tmp"
TMPDIR=$HOME/tmp npx eas-cli build --local --profile production --platform android
```

Cada build local deja varios GB en `~/tmp`; se pueden borrar cuando el APK o el AAB ya está generado. El CLI imprime la ruta del binario al terminar. `*.apk` y `*.aab` están en `.gitignore`.

Durante el build son normales los avisos `deprecated` de `react-native-reanimated` y `Hard link ... failed. Doing a slower copy instead.` (el caché de Gradle está en `/home` y el build en otro sistema de archivos). No tumban la compilación.

### Código de versión (versionCode)

Play Store rechaza un AAB cuyo `versionCode` ya se subió (`Ya se usó el código de la versión N`). Con `appVersionSource: remote` el contador vive en EAS, no en `app.json`. El perfil `production` tiene `autoIncrement: true`, así que cada build (nube o `--local`) lo sube solo.

Ver o fijar el contador a mano:

```bash
npx eas-cli build:version:get --platform android --profile production
npx eas-cli build:version:set --platform android --profile production
```

`version` en `app.json` (p. ej. `0.1.2`) es el nombre visible; el `versionCode` es independiente.

## Telemetría

`EXPO_NO_TELEMETRY=1` en `.env`, CI y los perfiles EAS `preview` y `production`. Sin `expo-updates`, `expo-insights` ni librerías de analíticas.

## Pantallas (expo-router)

Conexión, Conversaciones, Chat, Selector de modelo, Ajustes, Temas y Compartir — copys en español según el flujo de diseño.
