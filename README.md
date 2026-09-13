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
```

## Pendiente (requiere dispositivos/cuentas)

- Probar en emulador + dispositivo real (gama básica 2 GB).
- `EXPO_PUBLIC_API_URL` a producción + EAS Build + TestFlight / Play Internal.
- Icono/splash definitivos con identidad Nasa (`assets/icon.png` actual es
  temporal, derivado del logo web).
- Ver detalle en `../docs/SDD_Piiyaak_Implementacion.md` (B3) y vitácora.
