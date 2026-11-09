# Tareas SDD — `apk-offline-fase-b-app`: app offline-first con endpoints públicos

- **Change ID:** `apk-offline-fase-b-app`
- **Rama:** `feat/mobile-offline-fase-b`
- **Estrategia de entrega:** `single-pr`
- **Orden de ejecución:** B1 → B2 → B3 → B4. F1-a backend es bloqueante de B3 (tarea `F1-a-BE`).
- **Metodología:** TDD estricto en cada tarea. Cada tarea inicia con test en RED (se observa el fallo por la razón esperada), luego implementación mínima en GREEN, luego refactor conservando verde. Los tests utilizan código real (`MemoryWordStore`, `MemoryCourseStore`, `fetch` mockeado); los mocks se limitan a la frontera nativa (red y `expo-file-system`).
- **Convención de firmas:** toda función de lectura acepta `SessionState | null`. Con `null` se omite el encabezado de autenticación. Las funciones de escritura conservan el requerimiento de sesión.

---

## B1 — Gate de versión + sync lectura sin sesión + word-of-day anónimo

### B1-01 — Gate de versión: `getRemoteVersion` / `getLocalVersion` / `setLocalVersion`

- **Cierra:** CA2 (parcial: base del gate), CA8 (parcial).
- **Archivos:**
  - Crear: `src/db/version-gate.ts` (alternativa admitida: implementar dentro de `src/db/sync.ts`; documentar la decisión en el commit).
  - Crear: `src/db/version-gate.test.ts`.
  - Tocar: `src/db/memory-store.ts` (soporte de kv `piiyaak:contentVersion`; sin cambios de firma pública).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1: `getRemoteVersion(null)` realiza `GET /api/sync/version` sin encabezado `Authorization`/`Cookie` y valida con `VersionResponseSchema` (Zod). Test con `fetch` espiado: respuesta válida retorna `{ contentVersion, serverTime }`; respuesta inválida (sin `contentVersion`) lanza `ZodError`.
  - RED 2: `setLocalVersion` escribe `piiyaak:lastSync` y `piiyaak:contentVersion` de forma conjunta; `getLocalVersion` las retorna. Test: tras `setLocalVersion`, ambas claves existen; si una escritura falla (kv mock que lanza), la sincronización se considera no confirmada.
- **Dependencia:** ninguna (primera tarea del change).
- **Gate de salida:** `npx vitest run src/db/version-gate.test.ts` en verde; `tsc --noEmit` sin errores en archivos tocados.

### B1-02 — `syncNow` con gate por igualdad exacta + transición sin `contentVersion`

- **Cierra:** CA2 (completo).
- **Archivos:**
  - Tocar: `src/db/sync.ts` (`syncNow`, `fullSeed`, `incrementalSync`: aceptar `session: SessionState | null` documentado para lectura; gate interno).
  - Tocar: `src/db/sync.test.ts`, `src/db/store.test.ts` (agregar casos, no modificar semántica de los existentes).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`versión igual omite /api/sync`): `contentVersion` local igual a remota mockeada → `syncNow` retorna `{ applied: 0, removed: 0, hasMore: false }`, espía de `fetch` confirma cero llamadas a `/api/sync` y `/api/sync/seed`.
  - RED 2 (`versión distinta sincroniza y actualiza ambas claves`): versión distinta → se invoca sync y `piiyaak:lastSync` + `piiyaak:contentVersion` quedan escritas conjuntamente.
  - RED 3 (`instalación sin contentVersion hace sync completa una vez`): kv sin `contentVersion` pero con `lastSync` → ejecuta `fullSeed` (reutiliza `lastSync` como cursor `since`, no lo descarta) y adopta el gate desde entonces.
  - Regla: comparación por igualdad exacta de cadena, sin orden semántico (incluye subcaso borde 6.1: versión remota menor también dispara sincronización y adopta la versión remota).
- **Dependencia:** `B1-01`.
- **Gate de salida:** los tres tests nuevos en verde más suite existente `sync.test.ts` / `store.test.ts` sin regresiones.

### B1-03 — Arranque offline + corrección de sembrado bundle

- **Cierra:** CA1 (completo), R3.
- **Archivos:**
  - Tocar: `scripts/export-db.py` (sembrar `piiyaak:lastSync` con prefijo + `piiyaak:contentVersion` inicial + `schemaVersion "4"`; corregir siembra actual sin prefijo y `"3"`).
  - Tocar: `src/db/sqlite-store.ts` (`SCHEMA_VERSION "3"` → `"4"` en preparación; migración aditiva declarada, sin `DELETE`).
  - Crear o ampliar: `src/db/boot.test.ts` (test de arranque; si se prefiere, dentro de `src/db/sync.test.ts` con bloque `describe("arranque offline")`).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`arranque offline con fetch bloqueado resuelve bundle sin red`): `fetch = vi.fn()` que rechaza todo; store sembrado con palabras/categorías/cursos; `search`/`listAZ`/`getCourses` responden desde el store; `syncNow` no invoca red cuando el gate indica igualdad.
  - RED 2 (`bundle con lastSync sin prefijo dispara fullSeed — regresión R3`): siembra con clave `lastSync` sin prefijo; el gate no la reconoce y solicita red. Este test documenta el defecto que la corrección de `export-db.py` elimina.
- **Dependencia:** `B1-02` (requiere gate funcional para distinguir arranque con y sin red).
- **Gate de salida:** ambos tests en verde; verificación manual de `scripts/export-db.py` genera claves con prefijo correcto.

### B1-04 — Lectura sin sesión (`sync` / `syncCourses` con `authToken = null`)

- **Cierra:** CA3 (completo), CA6 (parcial: base sin sesión).
- **Archivos:**
  - Tocar: `src/db/sync.ts` (`fullSeed`, `incrementalSync` con `session = null`: omiten `Cookie`/`Authorization`; `apiFetch` ya lo soporta con `null`).
  - Tocar: `src/db/sync-courses.ts` (fase lectura: `session = null` sin encabezado de autenticación; sin cambiar estrategia de escritura en esta tarea).
  - Tocar: `src/db/sync.test.ts` (nuevos casos).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`syncCourses con authToken null no envía Authorization`): `fetch` espiado, `session = null`; verificación de ausencia de encabezado `Cookie`/`Authorization` y éxito de la llamada.
  - RED 2 (`sync/incremental con authToken null completa`): mismo mecanismo sobre `incrementalSync`.
  - Regla: ninguna lectura con token ausente produce 401 del lado cliente; un 401 del backend en endpoint público se clasifica como defecto de backend.
- **Dependencia:** `B1-02`.
- **Gate de salida:** tests nuevos en verde; `flushOutbox` conserva guarda `if (!session) return;` sin cambios (verificado por test existente).

### B1-05 — `word-of-day` anónimo

- **Cierra:** CA6 (completo).
- **Archivos:**
  - Tocar: `src/app/index.tsx` (`fetchWordOfDay(dateISO, session: SessionState | null)`; `GET /api/dictionary/word-of-day?date=<YYYY-MM-DD>` sin exigir sesión).
  - Crear: `src/app/word-of-day.test.ts` (o `src/db/word-of-day.test.ts` si se prefiere aislar la lógica; documentar ubicación en el commit).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`sin sesión retorna contenido sin escribir historial remoto`): `session = null`, `fetch` mockeado para word-of-day; verifica contenido resuelto vía `store.getById` y cero llamadas a `/api/dictionary/history`; caché kv `wodDate`/`wodId` sin cambios.
  - RED 2 (`con sesión registra historial`): `session` presente; verifica llamada a historial (test de no-regresión).
  - Regla: sin sesión se registra únicamente historial local + `outbox`; nunca historial de servidor; nunca error por ausencia de sesión.
- **Dependencia:** `B1-04` (reutiliza patrón de lectura con `null`).
- **Gate de salida:** ambos tests en verde; sin creación de endpoint nuevo.

---

## B2 — `syncCourses` atómico + unificación SQLite

### B2-01 — `MemoryCourseStore` con `runInTransaction` y rollback por snapshot

- **Cierra:** CA4 (parcial: infraestructura de test), CA8 (parcial).
- **Archivos:**
  - Tocar: `src/db/course-store.ts` (extender interfaz `CourseStore`: `removeCourse`, `removeModule`, `removeLesson`, `listCourseIds`, `listModuleIds`, `listLessonIds`, `runInTransaction`; `MemoryCourseStore` con rollback por snapshot).
  - Crear: `src/db/course-store.test.ts` (si no existe; caso contrario ampliar).
  - Ubicación de `MemoryCourseStore`: si no existe clase dedicada, crearla en `src/db/course-store.ts` junto a `SQLiteCourseStore` o en `src/db/memory-course-store.ts` (documentar elección en el commit). Debe replicar la cascada de `removeCourse` (módulos, lecciones y progreso asociado) que la implementación SQLite replica con `ON DELETE CASCADE` + borrado explícito de `course_progress` dentro de la misma transacción.
- **Test RED→GREEN que cierra la tarea:**
  - RED (`rollback ante fallo en upsert`): poblar `MemoryCourseStore`; ejecutar `runInTransaction` con fallo inyectado en `upsertLesson` a mitad; verificar snapshot restaurado (conteo y muestra idénticos antes/después) y excepción original relanzada.
  - Semántica exigida: copia de los mapas internos al entrar; ante excepción, restaura y relanza.
- **Dependencia:** `B1-04` (cierra B1 antes de iniciar B2).
- **Gate de salida:** test de rollback en verde; interfaz extendida compila (`tsc --noEmit`).

### B2-02 — `syncCourses` sin `clear` destructivo (upsert en transacción u staging + swap)

- **Cierra:** CA4 (completo).
- **Archivos:**
  - Tocar: `src/db/sync-courses.ts` (eliminar secuencia `clear + refetch`; implementar **una** estrategia: U upsert en transacción con `BEGIN IMMEDIATE … COMMIT` / `ROLLBACK`, o S staging + swap con tablas `courses_staging`, `modules_staging`, `lessons_staging`; documentar la elección U/S en el commit).
  - Tocar: `src/db/course-store.ts` (`SQLiteCourseStore.runInTransaction`: `BEGIN IMMEDIATE`, `fn()`, `COMMIT`; ante error `ROLLBACK` y relanza; prohibido `BEGIN DEFERRED` en esta ruta).
  - Tocar: `src/db/sqlite-store.ts` (si opción S: migración v4 con tablas de staging + `DROP TABLE` de staging tras primer swap exitoso; si opción U: sin tablas nuevas).
  - Crear o ampliar: `src/db/sync-courses.test.ts`.
- **Test RED→GREEN que cierra la tarea:**
  - RED (`fallo inyectado a mitad de syncCourses conserva contenido previo`): `MemoryCourseStore` con datos; `fetch` falla en el detalle del segundo curso; verifica conteo y muestra idénticos antes/después; no se escribe `contentVersion` ni cursor tras fallo.
  - Reconciliación de bajas: ids locales ausentes en respuesta remota se eliminan **dentro** de la misma transacción, nunca antes (cubierto por el mismo test con un curso eliminado en remoto).
  - Restricción normativa: prohibido llamar a `clearCourses()` antes de completar la descarga.
- **Dependencia:** `B2-01` (requiere `runInTransaction` + rollback verificado).
- **Gate de salida:** test de fallo inyectado en verde; `grep -rn "clearCourses" src/db/sync-courses.ts` sin llamadas previas a descarga completa.

### B2-03 — Unificación SQLite: conexión única vía `DbProvider`

- **Cierra:** R5/D5, CA4 (condición de atomicidad efectiva), CA8 (parcial).
- **Archivos:**
  - Tocar: `src/db-context.tsx` (exponer `courseStore: CourseStore | null` en `DbContextValue` existente, derivado de la misma instancia `SQLiteDatabase` que usa `SQLiteWordStore`; admitido como valor adicional sin provider separado; contrato `CourseStoreHandle { courses: CourseStore }`).
  - Tocar: `src/app/cursos/index.tsx`, `src/app/cursos/[id].tsx`, `src/app/cursos/leccion/[id].tsx` (eliminar llamadas propias a `openDatabaseSync("piiyaak.db")`; consumir store del provider).
- **Test RED→GREEN que cierra la tarea:**
  - RED: test de integración liviano (o verificación estática + test de provider) que confirma que las tres pantallas no abren conexión propia y que `courseStore` y `wordStore` comparten la misma instancia `SQLiteDatabase`. Si el test de pantallas resulta inviable sin dispositivo, se acepta verificación por `grep` (ausencia de `openDatabaseSync` en `src/app/cursos/**`) más test de provider que expone ambas tiendas desde una sola conexión.
- **Dependencia:** `B2-02`.
- **Gate de salida:** cero ocurrencias de `openDatabaseSync` en `src/app/cursos/**`; `tsc --noEmit` en verde.
- **Contingencia:** si se detecta bloqueador de migración de datos existentes, crear tarea explícita `B2-migrate-courses-db` (doble apertura temporal) con cierre obligatorio antes de B4. No se acepta como estado permanente.

---

## B3 — Media-cache por contenido + manifiesto + poda (bloqueada por F1-a-BE)

> `F1-a-BE` es bloqueante de `B3-02` (definición de clave por hash). `B3-01` (mock FS) puede iniciar en paralelo.

### F1-a-BE — Mini-change backend: campo `sha256` en `/api/sync` y `/api/sync/seed` [BLOQUEANTE DE B3]

- **Tipo:** change separado del backend (fuera de `feat/mobile-offline-fase-b`; este change de app lo consume de forma tolerante).
- **Cierra:** Origen del hash (fork F1, opción a); desbloquea clave por contenido determinista en B3.
- **Archivos (backend, referencial):** endpoints `GET /api/sync` y `GET /api/sync/seed` (payload por palabra: `audioSha256: string | null`, `illustrationSha256: string | null`; nombres exactos). Sin tocar `/api/sync/full`, `/api/sync/version` ni autenticación.
- **Criterios de aceptación propios del lado backend (independientes de CA1–CA8 de la app):**
  1. `GET /api/sync` y `GET /api/sync/seed` devuelven `audioSha256` e `illustrationSha256` por palabra con formato hexadecimal minúsculo de 64 caracteres (`[0-9a-f]{64}`) calculado sobre los bytes del archivo del medio (no URL ni metadatos).
  2. Estabilidad: mismo bytes → mismo hash en llamadas sucesivas.
  3. Medio ausente → `null` (no cadena vacía ni omisión del campo).
  4. Suite de contrato del backend en verde para ambas respuestas.
- **Test RED→GREEN (backend):** prueba de formato en ambas respuestas; prueba de estabilidad; prueba de `null` ante medio ausente.
- **Dependencia:** ninguna respecto a la app (se desarrolla en su propio change/branch backend).
- **Gate de salida:** los cuatro criterios verificados en CI del backend. La app (B3) funciona antes del despliegue mediante fallback F1-b (URL normalizada); tras el despliegue, el fallback queda como ruta muerta documentada con eliminación programada. Si F1-a resultara inviable, F1-b solo es aceptable como estado permanente con regla contractual explícita en backend: prohibidas las sobrescrituras in-place (todo reemplazo de medio genera URL nueva).

### B3-01 — Mock de `expo-file-system` desde cero + interfaz `MediaStore`

- **Cierra:** R6 (base), CA8 (parcial: nuevos mocks en suite), CA5 (parcial: infraestructura).
- **Archivos:**
  - Crear: `src/db/__mocks__/expo-file-system.ts` (mock con tienda en memoria; ubicación normativa: junto a los tests que lo consumen; alternativa admitida `src/test/mocks/expo-file-system.ts` si el proyecto centraliza mocks — documentar elección en el commit).
  - Superficie que cubre el mock (exacta, sin disco real): `documentDirectory`, `getInfoAsync(uri)`, `makeDirectoryAsync(uri)`, `downloadAsync(url, destUri)`, `deleteAsync(uri)`, `readDirectoryAsync(dirUri)`. Ningún test de medios toca disco real.
  - Crear: `src/db/media-cache.ts` (esqueleto: interfaces `MediaStore`, `MediaCache`, `MediaRef`, `MediaManifestRow`; implementación en tareas siguientes).
  - Crear: `src/db/media-cache.test.ts` (esqueleto con primer test de `MediaStore` en memoria).
- **Test RED→GREEN que cierra la tarea:**
  - RED: `vi.mock("expo-file-system", …)` con tienda en memoria; `downloadAsync` escribe bytes simulados, `getInfoAsync` reporta existencia, `deleteAsync` elimina, `readDirectoryAsync` lista. Test verifica ciclo escribir→existe→listar→eliminar sin tocar disco.
- **Dependencia:** `B2-03` (cierra B2 antes de iniciar B3, salvo `F1-a-BE` que corre en paralelo en su propio change).
- **Gate de salida:** mock operativo y test de ciclo en verde; `tsc --noEmit` en verde.

### B3-02 — `MediaCache`: clave por contenido + fallback URL + `buildManifest` + `ensureCached`

- **Cierra:** CA5 (parcial: poblado + fallback).
- **Archivos:**
  - Tocar: `src/db/media-cache.ts` (implementación completa de `localUriFor`, `ensureCached`, `exists`, `buildManifest`).
  - Tocar: `src/db/sqlite-store.ts` (tabla `media_manifest(word_id, kind, url, sha256, local_uri)`; migración v4 aditiva), `src/db/memory-store.ts` (espejo en memoria por `wordId + kind`: `upsertManifest`, `listManifest`, `clearManifestStale`).
  - Tocar: `src/db/media-cache.test.ts`.
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`sync exitosa puebla medios del manifiesto`): mock FS en memoria; tras sync, archivos por contenido existen localmente.
  - RED 2 (`sha256 ausente usa fallback por URL`): payload sin `*_sha256`; verifica clave `url_<normalizada>.<ext>` (URL sin query/fragmento, no alfanuméricos → `_`, truncada a 120; extensión de URL o `mp3`/`png` por defecto).
  - Reglas: nombre por hash `<sha256>.<ext>` cuando `sha256` presente; alcance del parser según spec §3 (palabras `PUBLISHED`, palabra del día vía `extra`, bloques lesson `audio`/`listening`/`image`, portadas `coverImage`; exclusiones: `youtubeId`/`video`, `text`/rich-text, `word`/`vocabulary`/`quiz` no duplicados, URLs no `https:` rechazadas con Zod y contabilizadas en `{ skipped }` sin abortar sync); poblado con concurrencia 4, reintentos 2 con espera 1000 ms, nunca tras sync fallida; verificación de integridad post-descarga solo en modo `sha256` (mismatch → elimina parcial, reintenta una vez, luego `{ failed: MediaRef[] }` sin bloquear sync).
- **Dependencia:** `B3-01`; bloqueada por `F1-a-BE` para la ruta hash (la ruta fallback F1-b permite GREEN parcial sin backend).
- **Gate de salida:** tests de poblado + fallback en verde.

### B3-03 — Poda contra manifiesto + protección de favoritas + doble lookup heredado

- **Cierra:** CA5 (completo).
- **Archivos:**
  - Tocar: `src/db/media-cache.ts` (`prune`), `src/audio.ts`, `src/illustrations.ts` (adaptadores que delegan en `MediaCache`; firmas públicas sin cambios; resolución por contenido con fallback heredado; migración perezosa en background sin bloquear reproducción), `src/app/ficha/[id].tsx` (resolución por contenido con fallback heredado).
  - Tocar: `src/db/media-cache.test.ts`.
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`segunda sync con manifiesto reducido poda huérfanos y conserva referenciados`): manifiesto v1 → v2 reducido; huérfanos eliminados, referenciados conservados; jamás podar durante sync incompleta/fallida.
  - RED 2 (`doble lookup: heredado por wordId migra perezosamente`): archivo heredado existente (`localAudioPath`/`localIllustrationPath`); `exists`/resolución lo encuentra y programa copia al nombre por contenido; nunca se escribe en la ruta heredada.
  - Regla de favoritas (borde 6.4): `prune` recibe el conjunto de favoritas (`piiyaak:favs`); archivo de palabra favorita se conserva aunque su hash salga del manifiesto; al desfavoritar cesa la protección; historial no protege.
- **Dependencia:** `B3-02`.
- **Gate de salida:** tests de poda + doble lookup en verde; firmas de `audio.ts` / `illustrations.ts` sin cambios.

---

## B4 — Endurecimiento + política outbox + adaptador de audio

### B4-01 — Política de `outbox`: límites, colapso por clave, FIFO con marca individual

- **Cierra:** CA7 (completo), R8.
- **Archivos:**
  - Tocar: `src/db/sync.ts` (`OUTBOX_MAX_PENDING = 500`, `OUTBOX_PAYLOAD_MAX_BYTES = 4096`; `addOutbox` rechaza payloads excedidos; escrituras nuevas rechazadas con error visible al alcanzar el límite en lugar de crecimiento ilimitado).
  - Tocar: `src/db/outbox.test.ts` (casos nuevos; existentes `flushOutbox` round-trip sin cambios de semántica), `src/db/memory-store.ts` si requiere soporte.
  - Documentar política §4 en el commit o en `openspec/changes/apk-offline-fase-b-app/spec.md` §4 (ya especificada; no rediseñar mecanismo).
- **Test RED→GREEN que cierra la tarea:**
  - RED 1 (`favoritas colapsan por clave; historial/progreso íntegros`): entradas contradictorias del mismo `wordId` se colapsan (prevalece la última) antes del envío; historial y progreso se drenan íntegros.
  - RED 2 (`límites`): `pendingOutbox()` con más de 500 entradas rechaza escritura nueva con error visible; payload mayor a 4096 bytes rechazado en `addOutbox`.
  - RED 3 (`FIFO con marca individual`): drenaje en orden ascendente de `id`; cada entrada se marca sincronizada solo ante respuesta `ok`; fallo de red o no-ok deja la entrada pendiente; `flushOutbox(store, null)` conserva no-operación especificada.
- **Dependencia:** `B3-03`.
- **Gate de salida:** tests nuevos + existentes de `outbox.test.ts` en verde.

### B4-02 — Adaptador de audio desacoplado de `expo-av`

- **Cierra:** R2, CA8 (parcial).
- **Archivos:**
  - Crear: `src/audio-player.ts` (o `src/db/audio-player.ts`; documentar ubicación): interfaz `AudioPlayer { load, play, pause, unload }` + `createAudioPlayer()`; consumo actual vía adaptador para sustitución futura por `expo-audio`. Sin migrar a `expo-audio`; `expo-av` 16 permanece.
  - Tocar: `src/audio.ts` (delega en el adaptador), tests correspondientes.
- **Test RED→GREEN que cierra la tarea:**
  - RED: `createAudioPlayer()` expone las cuatro operaciones; `load`/`play`/`pause`/`unload` delegan en el backend `expo-av` mockeado sin lanzar; sustitución del backend no cambia la firma del adaptador.
- **Dependencia:** `B4-01`.
- **Gate de salida:** test del adaptador en verde; sin cambios de SDK.

### B4-03 — Matriz final de 17 tests + `tsc` + linter en verde (CA8)

- **Cierra:** CA8 (completo). Verificación transversal de CA1–CA7.
- **Archivos:**
  - Tocar: `src/db/*.test.ts`, `src/db/media-cache.test.ts` (completar matriz §5: 17 tests listados en spec; reutilizar sin modificar semántica: reintentos, 401, deltas, seed paginado de `sync.test.ts`; ranking, DRAFT, seed/incremental con `session = null` de `store.test.ts`; round-trip de `outbox.test.ts`).
  - Registrar limitación 6.1 (bundle más nuevo que servidor adopta versión remota) como limitación conocida con recomendación operativa (no revertir backend sin regenerar bundle).
  - Sin cobertura intencionada (documentar en el commit): descarga real de bytes, reproducción en altavoz, poda masiva en almacenamiento real, migración sobre BD de usuario real, corte a nivel socket, firma/distribución APK, `expo-file-system` v18 fuera del mock, `expo-av` en hardware.
- **Test RED→GREEN que cierra la tarea:** la suite completa como test de cierre (cada test ya pasó en su tarea; esta tarea solo integra y estabiliza).
- **Dependencia:** `B4-02` (última tarea del change).
- **Gate de salida:** `tsc --noEmit` + linter del proyecto + suite completa en verde en CI, incluyendo nuevos mocks de FileSystem.

---

## Orden de dependencias (resumen)

```
B1-01 → B1-02 → B1-03 → B1-04 → B1-05
                                ↓
B2-01 → B2-02 → B2-03 succeeding B1
                    ↓
F1-a-BE (change backend separado, en paralelo; bloquea B3-02 ruta hash)
B3-01 → B3-02 → B3-03 succeeding B2
                    ↓
B4-01 → B4-02 → B4-03 (cierre)
(B2-migrate-courses-db condicional entre B2-03 y B4-01 si aparece bloqueador)
```

---

## Review Workload Forecast

- **Delivery strategy:** `single-pr` (fijada para este change).
- **Chained PRs recommended:** No (la estrategia `single-pr` prevalece; no se propone cadena apilada ni feature-branch chain).
- **400-line budget risk:** High.
- **Changed lines estimadas:** ~1400–1900 líneas totales (código + tests + migración + `export-db.py`), desglose aproximado:
  - B1 (gate, sync `null`, sembrado, word-of-day, tests): ~350–450.
  - B2 (interfaz `CourseStore`, `MemoryCourseStore` + rollback, `syncCourses` transaccional, unificación provider + 3 pantallas, tests): ~350–500.
  - B3 (mock FS, `media-cache.ts`, manifiesto SQLite/memoria, adaptadores audio/ilustraciones, `ficha/[id].tsx`, tests CA5): ~450–600.
  - B4 (límites outbox + colapso, adaptador audio, estabilización suite): ~200–300.
  - `scripts/export-db.py` + migración v3→v4: ~50–100.
- **Conclusión de presupuesto:** el total supera el umbral de 400 líneas de forma estructural (múltiples unidades de entrega: gate, atomicidad, media-cache, endurecimiento). No es posible un slicing con sentido dentro de `single-pr` sin violar la atomicidad del change offline-first.
- **Decisión needed before apply:** Yes — se requiere `size:exception` explícita de quien mantiene el repositorio antes del `apply`, con justificación: el change implementa cuatro objetivos acoplados (O1–O4) con matriz de 17 tests y migración de esquema aditiva; dividirlo rompería las garantías de atomicidad (B2) y de manifiesto (B3) verificadas de forma conjunta en CA8. Solicitar `size:exception` para `single-pr` de ~1400–1900 líneas antes de ejecutar el apply.
