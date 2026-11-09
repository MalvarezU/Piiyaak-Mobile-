# Informe de verificación — `apk-offline-fase-b-app`

- **Rama:** `feat/mobile-offline-fase-b`
- **Fecha:** 2026-11-09
- **Rol:** validador independiente (sin autoría sobre el código revisado)
- **Alcance:** implementación completa B1–B4 + F1 contra `proposal.md`, `spec.md` y `tasks.md`
- **Idioma del informe:** español neutro/profesional

## 1. Cobertura por fase

### B1 — Gate de versión + sync lectura sin sesión + word-of-day anónimo — COMPLETA

| Criterio | Evidencia de test | Resultado |
|---|---|---|
| `getRemoteVersion(null)` sin `Authorization`/`Cookie`, validación Zod, rechazo ante respuesta sin `contentVersion` | `src/db/version-gate.test.ts` (2 tests) | PASS |
| `setLocalVersion` escribe `piiyaak:lastSync` + `piiyaak:contentVersion` conjuntamente; fallo de escritura = sync no confirmada | `src/db/version-gate.test.ts` (2 tests) | PASS |
| Versión igual omite `/api/sync` y `/api/sync/seed`, retorna `{ applied: 0, removed: 0, hasMore: false }` | `src/db/sync.test.ts` → "versión igual omite /api/sync y /api/sync/seed" | PASS |
| Versión distinta sincroniza y actualiza ambas claves | `src/db/sync.test.ts` → "versión distinta sincroniza y actualiza ambas claves" | PASS |
| Instalación sin `contentVersion` hace sync completa una vez, reutiliza `lastSync` como cursor `since` | `src/db/sync.test.ts` (2 tests: con y sin `lastSync`) | PASS |
| Subcaso borde 6.1: versión remota menor también sincroniza y adopta la remota (igualdad exacta) | `src/db/sync.test.ts` → "versión remota menor también sincroniza y adopta la remota (borde 6.1)" | PASS |
| Arranque offline con `fetch` bloqueado resuelve bundle sin red de sync | `src/db/sync.test.ts` → "arranque offline con fetch bloqueado resuelve bundle sin red de sync" | PASS |
| Regresión R3: `lastSync` sin prefijo no es reconocida por el gate y dispara sync | `src/db/sync.test.ts` → "bundle con lastSync sin prefijo dispara sync (regresión R3)" | PASS |
| `incrementalSync` y `syncCourses` con `authToken = null` completan sin encabezados de auth | `src/db/sync.test.ts` (2 tests "lectura sin sesión") | PASS |
| `flushOutbox(store, null)` conserva no-operación | `src/db/sync.test.ts` + `src/db/outbox.test.ts` | PASS |
| `SCHEMA_VERSION "4"` con `media_manifest` aditiva; espejo en memoria; `export-db.py` siembra claves con prefijo + `contentVersion` + schema 4 | `src/db/boot.test.ts` (3 tests) | PASS |
| `word-of-day` anónimo: sin sesión retorna contenido vía store local sin llamadas a `/api/dictionary/history`; con sesión no contamina outbox local; offline con caché vigente devuelve cacheada; vista local registra historial + outbox | `src/db/word-of-day.test.ts` (7 tests) | PASS |
| Corrección de sembrado bundle | `scripts/export-db.py` líneas 169–176: inserta `piiyaak:lastSync`, `piiyaak:contentVersion` y `schemaVersion "4"`; verificado por `boot.test.ts` | PASS (estático) |

Cierra: CA1, CA2, CA3, CA6 (parcial B1; CA6 completo con B1-05), R3. Tareas B1-01–B1-05 verificadas.

### B2 — `syncCourses` atómico + unificación SQLite — COMPLETA

| Criterio | Evidencia | Resultado |
|---|---|---|
| `MemoryCourseStore.runInTransaction` con rollback por snapshot y relanzamiento de la excepción original; cascada de `removeCourse`/`removeModule`/`removeLesson` con progreso | `src/db/course-store.test.ts` (5 tests) | PASS |
| `SQLiteCourseStore.runInTransaction` con `BEGIN IMMEDIATE … COMMIT`, `ROLLBACK` ante fallo (nunca `BEGIN DEFERRED`), borrado explícito bottom-up de `course_progress` | `src/db/course-store.sqlite.test.ts` (3 tests, describe el `PRAGMA foreign_keys = ON` como defensa en profundidad) | PASS |
| Opción U elegida y documentada (upsert en transacción; sin tablas staging, sin `DROP` huérfanas) | `src/db/sync-courses.ts` líneas 36–48 + commit `b3770ff` | PASS |
| Fallo inyectado a mitad de `syncCourses` conserva contenido previo intacto; reconciliación de bajas dentro de la misma transacción, incluido progreso huérfano; doble sync idempotente | `src/db/sync-courses.test.ts` (3 tests) | PASS |
| Prohibición de `clear + refetch`: `clearCourses` marcado `@deprecated`, sin llamadas en la ruta de sync (`grep` sin resultados en `src/db/sync-courses.ts`) | Verificación estática + commit `54596a2` | PASS |
| Unificación SQLite: `DbProvider` (`src/db-context.tsx` líneas 81–86) deriva `SQLiteCourseStore` de la misma instancia `SQLiteDatabase`; cero `openDatabaseSync` en `src/app/cursos/**` (grep sin resultados); las tres pantallas consumen `courseStore` del provider | `src/app/cursos/index.tsx`, `[id].tsx`, `leccion/[id].tsx` | PASS |
| Contingencia `B2-migrate-courses-db`: no fue necesaria (no se detectó bloqueador de migración); no existe como tarea pendiente | — | N/A justificado |

Cierra: CA4, R5/D5. Tareas B2-01–B2-03 verificadas.

### B3 — Media-cache por contenido + manifiesto + poda — COMPLETA (con advertencia W2)

| Criterio | Evidencia | Resultado |
|---|---|---|
| Mock FS desde cero + interfaces `MediaStore`/`MediaCache`/`MediaRef`/`MediaManifestRow` | `src/db/__mocks__/expo-file-system.ts`, `src/db/media-cache.test.ts` → "ciclo escribir→existe→listar→eliminar sin tocar disco" | PASS |
| Clave por contenido `<sha256>.<ext>` con hash; fallback `url_<normalizada>.<ext>` (normalización: sin query/fragmento, no alfanuméricos → `_`, máx. 120; ext de URL o `mp3`/`png`) | `src/db/media-cache.test.ts` (2 tests `localUriFor`) | PASS |
| `buildManifest`: solo `PUBLISHED`, hashes desde `audioSha256`/`illustrationSha256`, `DRAFT` excluidos, fallback sin hashes | `src/db/media-cache.test.ts` (2 tests) | PASS |
| Alcance del parser §3.1–§3.2: bloques lesson `audio`/`listening` (`media.url`) e `image` (`block.url`) con `wordId: "lesson:<id>"`; portadas `coverImage` de cursos `PUBLISHED` con `wordId: "course:<id>"`; exclusiones `video`/`youtubeId`, `text`/rich-text, `word`/`vocabulary`/`quiz`; URLs no-`https:` rechazadas con Zod y contabilizadas en `skipped` | `src/db/media-cache.test.ts` (2 tests) | PASS |
| `ensureCached`: descarga, no re-descarga si existe, 2 reintentos con espera 1000 ms inyectable, concurrencia 4 en `ensureAllCached`, `failed` sin bloquear el resto | `src/db/media-cache.test.ts` (3 tests) | PASS |
| Poblado tras sync exitosa + poda contra manifiesto persistido con protección de favoritas; tras sync fallida no se puebla ni se poda; `clearManifestStale` conserva vigentes + favoritas; poblado fallido no elimina preexistentes | `src/db/sync-media.test.ts` (3 tests) + `src/db/media-cache.test.ts` (4 tests) | PASS |
| Doble lookup heredado por `wordId` con migración perezosa en background sin bloquear; nunca se escribe en la ruta heredada; cubre audio e ilustraciones | `src/media-adapters.test.ts` (7 tests), `src/audio.ts`, `src/illustrations.ts`, `src/app/ficha/[id].tsx` (usa `resolveAudioUri`/`resolveIllustrationUri`) | PASS |
| Firmas públicas de `audio.ts` / `illustrations.ts` sin cambios (funciones existentes conservadas como delegación) | Lectura de ambos módulos | PASS |
| Poblado + poda integrados tras `syncNow` exitosa en el provider (`sync` en `src/db-context.tsx` líneas 173–181, best-effort sin revertir sync) y vía `syncNowAndRefreshMedia` | `src/db/sync-media.ts`, `src/db-context.tsx` | PASS |

Cierra: CA5. Tareas B3-01–B3-03 (+ B3-04 de integración `sync-media.ts`) verificadas, salvo W2.

### B4 — Endurecimiento + política outbox + adaptador de audio — COMPLETA

| Criterio | Evidencia | Resultado |
|---|---|---|
| `OUTBOX_MAX_PENDING = 500`, `OUTBOX_PAYLOAD_MAX_BYTES = 4096` expuestos y aplicados en `addOutbox` (SQLite y memoria consultan el pendiente antes de insertar); rechazo con `OutboxLimitError` y mensaje visible al usuario | `src/db/outbox.ts`, `src/db/sqlite-store.ts` líneas 281–291, `src/db/memory-store.ts` líneas 88–91, `src/db/outbox.test.ts` (4 tests de límites) | PASS |
| Colapso por clave: solo la última favorita por `wordId` se envía; historial/progreso íntegros; entradas subsumidas marcadas junto al `ok` de la superviviente | `src/db/outbox.ts` (`collapseOutboxForDrain`, pura y testeable), `src/db/sync.ts` (`flushOutbox` líneas 183–235), `src/db/outbox.test.ts` | PASS |
| FIFO en orden ascendente de `id`, marca individual solo ante `ok`, fallo/no-ok deja pendiente sin bloquear el resto | `src/db/outbox.test.ts` → "drena en orden ascendente…" | PASS |
| `AudioPlayer { load, play, pause, unload }` + `createAudioPlayer(backend)`; delegación en `expo-av` mockeado; sustitución de backend sin cambio de firma; `expo-av` 16 permanece | `src/audio-player.ts`, `src/audio-player.test.ts` (5 tests) | PASS (ver S1) |
| Matriz de 17 tests de spec §5: presente con extras (la suite contiene todos los casos listados más borde 6.1 y casos de integración) | `npx vitest run`: 17 archivos, 130 tests, todos en verde | PASS |

Cierra: CA7, R8, R2 (adaptador, sin migración). Tareas B4-01–B4-03 verificadas.

## 2. Verificación F1 (origen del hash)

- **Consumo tolerante en la app (F1-a + fallback F1-b): IMPLEMENTADO.** `WordRow` declara `audioSha256?` / `illustrationSha256?` (`src/db/types.ts` líneas 20–21); `collectMediaRefs` usa `w.audioSha256 ?? null` (`src/db/media-cache.ts` líneas 341/349); `fileNameFor` elige `<sha256>.<ext>` solo con formato `[0-9a-f]{64}` válido y cae a `url_<normalizada>.<ext>` en caso contrario (líneas 117–123). Tests de ambas rutas en `media-cache.test.ts`.
- **Producción del campo por el backend (F1-a-BE): NO VERIFICABLE en esta rama.** `F1-a-BE` es un change separado del backend; este repositorio no contiene el backend ni sus tests de contrato (formato, estabilidad, `null` ante medio ausente). La app opera correctamente antes del despliegue mediante el fallback F1-b. Se registra como **limitación, no como fallo** (ver §5).
- **Integridad post-descarga (§6.3): PARCIAL — ver W2.** El mecanismo existe (`MediaIntegrityError`, reintento + `failed`), pero solo actúa cuando el llamador inyecta `verify`; ningún llamador de producción lo inyecta (la frontera `MediaStore` no expone lectura de bytes para el digest).

## 3. Regresiones (suites preexistentes)

`npx vitest run` — **17 archivos, 130 tests, todos en verde.** Ningún test existente cambió de semántica: `sync.test.ts` (reintentos, 401, deltas, seed paginado), `store.test.ts` (ranking, DRAFT, seed/incremental con `session = null`), `outbox.test.ts` (round-trip) conservan sus casos originales; los nuevos casos son aditivos. Suites ajenas al change (`api.test.ts`, `ordena-tokenizer`, `rich-text`, `registro`) siguen en verde.

## 4. Lista de hallazgos

### CRITICAL

Ninguno.

### WARNING

- **W1 — Campo `sha256` del backend sin verificación de contrato en este repo.** La ruta por hash se testea con hashes sintéticos; no existe evidencia aquí de que `GET /api/sync` y `GET /api/sync/seed` devuelvan `audioSha256` / `illustrationSha256` con el formato `[0-9a-f]{64}` sobre bytes del medio. **Acción:** al archivar, exigir el gate de salida de `F1-a-BE` en CI del backend (4 criterios de tasks.md) o activar la salvaguarda contractual F1-b (prohibición de sobrescrituras in-place documentada en backend). Mientras tanto el fallback URL es correcto y seguro.
- **W2 — Verificación de integridad post-descarga inactiva en la ruta de producción.** `createMediaCache` solo verifica cuando se inyecta `opts.verify` (default: sin verificación; documentado en `media-cache.ts` líneas 134–140). `refreshMediaAfterSync` y `db-context` no inyectan `verify`, de modo que en modo `sha256` un mismatch (CDN que transforma bytes, corrupción) no se detecta y el archivo queda cacheado como válido. El mecanismo (eliminar parcial, reintentar una vez, reportar `failed`) está implementado y testeado con `verify` inyectado. **Acción sugerida (follow-up, no bloqueante):** exponer lectura de bytes en la frontera `MediaStore` (p. ej. `readBytes`/`digest`) y activar `verify` por defecto en `defaultMediaCache`; hoy el riesgo residual es el mismo que F1-b, documentado y acotado.

### SUGGESTION

- **S1 — `AudioPlayer.load` acepta un segundo parámetro opcional `onFinished` no previsto en spec §1.4 (`load(uri)`).** Es aditivo y compatible (los 5 tests lo cubren, incluido `onFinished` al terminar). Sugerencia: alinear la spec o documentar el parámetro como extensión intencional; no requiere cambio de código.
- **S2 — `clearCourses` conservado como `@deprecated`.** Correcto según spec (solo prohíbe su uso en la ruta de sync; el `grep` confirma cero llamadas allí). Sugerencia: programar su eliminación total una vez que el fallback F1-b se retire, para cerrar la superficie destructiva.
- **S3 — `getLocalVersion` lee `contentVersion` vía `getKV` directo mientras `lastSync` usa `getLastSync`.** Comportamiento equivalente hoy (misma tabla `kv`), pero dos caminos de lectura para claves hermanas. Sugerencia menor de simetría; sin impacto funcional.

## 5. Limitaciones explícitas (no ejecutable en este entorno — no son fallos)

1. **Dispositivo físico:** no disponible. Sin verificación de descarga real de bytes, reproducción en altavoz, rendimiento de poda masiva en almacenamiento real, ni migración sobre BD de usuario instalada.
2. **`expo-sqlite` real:** los tests usan `MemoryWordStore`/`MemoryCourseStore` y `course-store.sqlite.test.ts` usa una BD mockeada/inyectada, no el motor SQLite del dispositivo. La semántica transaccional real (`BEGIN IMMEDIATE` en hardware) no se ejecuta aquí.
3. **R2 / red real:** toda la red está mockeada a nivel `fetch`; corte a nivel socket, latencia y reintentos con `sleep` real no se ejercitan (los tests inyectan `sleep`/`retryDelayMs`).
4. **Backend F1-a-BE:** fuera de este repositorio y de esta rama (ver W1).
5. **Firma/distribución APK, `expo-file-system` v18 fuera del mock, `expo-av` en hardware:** sin cobertura intencionada según spec §5 ("Explícitamente sin cubrir").

## 6. Veredicto

**PASS con advertencias no bloqueantes (W1, W2 documentadas como follow-ups).**

Comandos corridos y resultado observado:

- `npx vitest run` → `Test Files 17 passed (17)` / `Tests 130 passed (130)` / `Duration 7.16s`.
- `npx tsc --noEmit` → salida vacía, exit 0.
- Linter → **N/A con evidencia:** `package.json` no define script de lint y el repo no contiene configuración de linter (sin `eslint.config.*`, `.eslintrc*` ni `biome.json`); tasks B4-03 lo presupone pero no existe en el proyecto. No se inventa un gate inexistente.

La implementación cubre B1-01–B1-05, B2-01–B2-03, B3-01–B3-03 (+ integración B3-04), B4-01–B4-03 y el consumo tolerante F1 (hash + fallback). No se escribió código nuevo durante esta validación; no fue necesario ningún fix bloqueante.

## 7. Archivos tocados por esta validación

- Creado: `openspec/changes/apk-offline-fase-b-app/verify-report.md` (este informe).
