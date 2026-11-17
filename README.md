# Piiyaak App (móvil)

App React Native + Expo (B3.3): diccionario Nasa Yuwe offline-first.

## Estado

Scaffold funcionaltegración con `/api/sync` + `/api/sync/seed`:

- `src/db/`: SQLite local (`sqlite-store.ts`), `MemoryWordStore` (tests),
  `sync.ts` (seed inicial + deltas), `types.ts`, `normalize.ts` (sin tildes,
  como el `unaccent()` del servidor).
- `src/api.ts`: `API_BASE_URL` + login headless NextAuth (csrf → callback →
  cookie de sesión).
- `src/auth.tsx`, `src/db-context.tsx`: sesión, favoritas e historial
  locales (AsyncStorage), `lastSync` + sincronización manual.
- `src/audio.ts`: descarga de audios solo de favoritas.
- Pantallas (expo-router): Buscar, Ficha, A-Z, Favoritas, Historial, Ajustes.

## Comandos

```bash
npm install
npx tsc --noEmit   # tipos
npx vitest run     # lógica (sync, store, ranking)
npx expo start     # desarrollo (requiere Expo Go o emulador)

## Desarrollo por USB (recomendado)

La app NO se ejecuta bien vía URL `exp://192.168.x.x:PORT` en Expo Go (incompatibilidad /
problemas de red). Usar depuración USB conectada al PC:

1. Activar "Depuración USB" (y "Instalar por USB" en MIUI/HyperOS) en el celular.
2. `adb devices` → confirmar el equipo.
3. `adb reverse tcp:8081 tcp:8081` (o el puerto de Metro).
4. `npx expo start --dev-client` (Metro en 8081).
5. `adb shell am start -a android.intent.action.VIEW -d "exp+piiyaak://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`.

Si el APK de desarrollo no está instalado (firma distinta a la build de producción),
desinstalar `com.piiyaak.app` y reinstalar el `.apk` debug generado por
`npx expo run:android --device <modelo>`. Requiere `JAVA_HOME=/usr/lib/jvm/java-21-openjdk`
(si el shell apunta a una ruta de Android Studio inexistente).
```

## Pendiente (requiere dispositivos/cuentas)

- Probar en emulador + dispositivo real (gama básica 2 GB).
- `EXPO_PUBLIC_API_URL` a producción + EAS Build + TestFlight / Play Internal.
- Icono/splash definitivos con identidad Nasa (`assets/icon.png` actual es
  temporal, derivado del logo web).
- Ver detalle en `../docs/SDD_Piiyaak_Implementacion.md` (B3) y vitácora.
