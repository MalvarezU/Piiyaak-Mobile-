# Seguridad — App móvil Piiyaak

Checklist de hardening de la app móvil (Fase D del plan de cierre).

## Almacenamiento de credenciales
- [x] Sesión (cookie NextAuth + user) en `expo-secure-store` (`src/auth.tsx`), nunca en AsyncStorage.
- [x] Logout borra la entrada de SecureStore.
- [x] Al arrancar, la sesión se valida contra `/api/auth/session`; si es inválida se descarta.

## Transporte
- [x] `API_BASE_URL` debe usar `https://` en producción (`src/api.ts` lanza error si no).
- [x] `apiFetch` con timeout de 15 s (`AbortController`).
- [ ] Verificar en EAS que `EXPO_PUBLIC_API_URL` de prod sea `https://`.

## Datos locales
- [x] SQLite en `documentDirectory/SQLite/` (sandbox de la app).
- [x] Audios e ilustraciones en `documentDirectory/audios/` e `illustrations/` (sandbox).
- [x] Sin `console.log` con cookies, tokens o datos de usuario (auditado: solo `bench-search.ts` loguea métricas).
- [ ] SQLite sin cifrado: aceptable (diccionario público; favoritas/historial no son datos sensibles).

## Permisos
- [x] Sin permisos de cámara, ubicación, contactos, micrófono declarados.
- [x] Solo red + almacenamiento local.

## Logs
- [x] `src/api.ts`, `src/auth.tsx`, `src/db-context.tsx` no loguean datos de usuario.
- [x] Errores genéricos ("login failed") sin detalles.

## Pendiente (fuera de este repo, en EAS)
- [ ] Configurar `EXPO_PUBLIC_API_URL` de prod con HTTPS.
- [ ] Revisar que no haya `http://` en ningún env de EAS.