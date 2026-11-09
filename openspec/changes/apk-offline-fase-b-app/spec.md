# Especificación SDD — `apk-offline-fase-b-app`: app offline-first con endpoints públicos

- **Change ID:** `apk-offline-fase-b-app`
- **Rama de trabajo:** `feat/mobile-offline-fase-b`
- **Estado:** especificación (sin implementación)
- **Idioma:** español neutro/profesional
- **Propuesta base:** `openspec/changes/apk-offline-fase-b-app/proposal.md` (O1–O4, diseño 5.1–5.6, fork F1, plan B1–B4, CA1–CA8)
- **Backend requerido:** Fase A+B ya desplegado; único cambio admitido: mini-change F1-a (campo `sha256`)

---

## 1. Contratos por fase (firmas TypeScript exactas)

Convenciones comunes a todas las fases:

- `SessionState` es el tipo existente de `src/api.ts`. Toda función de **lectura** acepta `authToken: SessionState | null`. Con `null`, la implementación omite el encabezado de autenticación en lugar de lanzar error o redirigir a login.
- Ninguna llamada de lectura ante token ausente produce 401 del lado cliente. Si el backend respondiera 401 en un endpoint declarado público, se clasifica como defecto de backend y no se corrige con login forzado.
- Las funciones de **escritura** (favoritas, historial, progreso) conservan el requerimiento de sesión vigente y no cambian de firma.

### 1.1 Fase B1 — Gate de versión + sync lectura sin sesión + word-of-day anónimo

Nuevas funciones en `src/db/sync.ts` (o módulo `src/db/version-gate.ts` si se prefiere aislar el gate; la spec admite ambas ubicaciones siempre que las firmas se conserven):

```typescript
export interface VersionInfo {
  contentVersion: string;
  serverTime: string;
}

export declare function getRemoteVersion(
  authToken: SessionState | null
): Promise<VersionInfo>;

export declare function getLocalVersion(
  store: WordStore
): Promise<{ contentVersion: string | null; lastSync: string | null }>;

export declare function setLocalVersion(
  store: WordStore,
  version: VersionInfo
): Promise<void>;
```

Semántica:

- `getRemoteVersion(null)` realiza `GET /api/sync/version` **sin** encabezado de autenticación y valida la respuesta con Zod antes de usarla (patrón `react-native-patterns`: validar en el borde):

```typescript
import { z } from "zod";

export const VersionResponseSchema = z.object({
  contentVersion: z.string().min(1),
  serverTime: z.string().datetime(),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;
```

- `setLocalVersion` escribe `piiyaak:lastSync` y `piiyaak:contentVersion` de forma conjunta (ver sección 2.1). Nunca escribe una clave sin la otra fuera de la migración de transición.
- Flujo de sincronización de lectura (modifica `syncNow` sin cambiar su firma pública):

```typescript
export declare function syncNow(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult>;
```

Nuevo comportamiento interno de `syncNow`:

1. Llama a `getRemoteVersion(session)`.
2. Si `contentVersion` local coincide con la remota, retorna `{ applied: 0, removed: 0, serverTime: <remota>, hasMore: false }` sin invocar `/api/sync` ni `/api/sync/seed`.
3. Si difiere, ejecuta la rama existente (`fullSeed` si no hay datos ni `lastSync`; `incrementalSync` en caso contrario) y al finalizar llama a `setLocalVersion` con la versión remota y el `serverTime` resultante.
4. Transición: si no existe `contentVersion` local (instalaciones previas), ejecuta una sincronización completa una vez y adopta el gate desde entonces. El valor `lastSync` existente se reutiliza como cursor `since`; no se descarta.

Firmas modificadas en `src/db/sync.ts`:

```typescript
export declare function fullSeed(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult>;

export declare function incrementalSync(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult>;
```

El cambio respecto al estado actual es exclusivamente la aceptación documentada de `session = null` para lectura (omite `Cookie`/`Authorization`; `apiFetch` ya lo soporta al recibir `null`). `flushOutbox` conserva su firma y su guarda `if (!session) return;`.

Word-of-day anónimo (modifica `src/app/index.tsx`, sin crear endpoint nuevo):

```typescript
export interface WordOfDayResult {
  wordId: string;
}

export declare function fetchWordOfDay(
  dateISO: string, // "YYYY-MM-DD"
  session: SessionState | null
): Promise<WordOfDayResult | null>;
```

Semántica:

- Llama a `GET /api/dictionary/word-of-day?date=<YYYY-MM-DD>` sin exigir sesión. Con `null`, omite el encabezado de autenticación.
- Si existe sesión, el llamador registra historial en servidor como hasta ahora. Sin sesión, muestra el contenido local (`store.getById`) y registra únicamente historial local + `outbox` (ver sección 4). Nunca escribe historial de servidor sin sesión y nunca lanza error por ausencia de sesión.
- El caché por fecha en kv (`wodDate`/`wodId`) se conserva sin cambios.

### 1.2 Fase B2 — `syncCourses` atómico + unificación SQLite

Estado actual: `syncCourses` ejecuta `clearCourses()` seguido de `refetch` por curso, y las pantallas de cursos (`src/app/cursos/*`) abren su propia conexión con `openDatabaseSync("piiyaak.db")`, separada de la conexión del `DbProvider`.

Contrato nuevo en `src/db/sync-courses.ts`:

```typescript
export interface CourseSyncResult {
  courses: number;
  modules: number;
  lessons: number;
}

export declare function syncCourses(
  store: CourseStore,
  session: SessionState | null
): Promise<CourseSyncResult>;
```

Restricciones normativas sobre la implementación elegida:

- **Prohibido** llamar a `clearCourses()` antes de completar la descarga. La secuencia `clear + refetch` queda eliminada.
- La implementación debe elegir **una** de las dos estrategias (decisión a documentar en el commit de B2):
  - **Opción U (upsert en transacción):** envolver altas/modificaciones/bajas del árbol curso→módulo→lección en una transacción SQLite (`BEGIN IMMEDIATE … COMMIT`, `ROLLBACK` ante cualquier fallo). Requiere método transaccional en el store (ver abajo).
  - **Opción S (staging + swap):** escribir en tablas temporales (`courses_staging`, `modules_staging`, `lessons_staging`) y renombrar/intercambiar al finalizar con éxito dentro de una transacción. Requiere migración de esquema v4 con las tablas de staging.
- **Bajas:** el `refetch` por curso no informa eliminaciones. La implementación debe reconciliar por diferencia: los ids locales de cursos/módulos/lecciones ausentes en la respuesta remota se eliminan **dentro** de la misma transacción, nunca antes.

Extensión requerida de la interfaz `CourseStore` (`src/db/course-store.ts`):

```typescript
export interface CourseStore {
  // …métodos existentes sin cambios…
  upsertCourse(course: CourseRow): Promise<void>;
  upsertModule(mod: ModuleRow): Promise<void>;
  upsertLesson(lesson: LessonRow): Promise<void>;
  removeCourse(id: string): Promise<void>;
  removeModule(id: string): Promise<void>;
  removeLesson(id: string): Promise<void>;
  listCourseIds(): Promise<string[]>;
  listModuleIds(courseId: string): Promise<string[]>;
  listLessonIds(moduleId: string): Promise<string[]>;
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

- `MemoryCourseStore` implementa `runInTransaction` con semántica de rollback por snapshot (copia de los mapas internos; ante excepción, restaura y relanza). `removeCourse` en memoria elimina en cascada sus módulos, lecciones y progreso asociado; la implementación SQLite debe replicar la cascada dentro de la misma transacción (las FK con `ON DELETE CASCADE` actuales no cubren `course_progress`, que requiere borrado explícito).
- `SQLiteCourseStore.runInTransaction` ejecuta `BEGIN IMMEDIATE`, luego `fn()`, luego `COMMIT`; ante error, `ROLLBACK` y relanza la excepción original. No se admite `BEGIN DEFERRED` para esta ruta (riesgo de `SQLITE_BUSY` silencioso ante lecturas concurrentes del hilo de UI).

Unificación SQLite (cierra R5/D5):

- `DbProvider` (`src/db-context.tsx`) expone la conexión única. Las pantallas `src/app/cursos/index.tsx`, `src/app/cursos/[id].tsx` y `src/app/cursos/leccion/[id].tsx` **dejan de llamar** a `openDatabaseSync` y consumen el store de cursos derivado de la conexión del provider.
- Contrato en `src/db-context.tsx`:

```typescript
export interface CourseStoreHandle {
  courses: CourseStore;
}
```

Se admite implementarlo como valor adicional del `DbContextValue` existente (`courseStore: CourseStore | null`) sin crear un provider separado. La conexión subyacente es la misma instancia `SQLiteDatabase` que usa `SQLiteWordStore`, de modo que contenido y cursos participan de la misma conexión y las transacciones de B2 son efectivas.

- Si durante B2 se detecta un bloqueador de migración de datos existentes, se admite **una** tarea explícita de migración con doble apertura temporal, con fecha de cierre dentro de este change. No se acepta como estado permanente. La tarea debe nombrarse `B2-migrate-courses-db` y cerrarse antes de B4.

### 1.3 Fase B3 — Media-cache por contenido + manifiesto + poda

Nuevo módulo `src/db/media-cache.ts` (aisla `expo-file-system` tras una interfaz testeable; responde a R1 y R6):

```typescript
export type MediaKind = "audio" | "illustration";

export interface MediaRef {
  wordId: string;
  kind: MediaKind;
  url: string;
  sha256: string | null; // null = fallback por URL (modo F1-b)
}

export interface MediaManifestRow {
  wordId: string;
  kind: MediaKind;
  url: string;
  sha256: string | null;
  localUri: string;
}

export interface MediaStore {
  getInfo(uri: string): Promise<{ exists: boolean }>;
  makeDir(uri: string): Promise<void>;
  download(url: string, destUri: string): Promise<{ uri: string }>;
  remove(uri: string): Promise<void>;
  listDir(dirUri: string): Promise<string[]>;
}

export interface MediaCache {
  localUriFor(ref: MediaRef): string;
  ensureCached(ref: MediaRef): Promise<string>; // retorna localUri
  exists(ref: MediaRef): Promise<boolean>;
  prune(manifest: readonly MediaManifestRow[]): Promise<{ removed: number }>;
  buildManifest(words: readonly WordRow[], extra: readonly MediaRef[]): Promise<MediaManifestRow[]>;
}
```

Reglas normativas:

- **Derivación de clave:** si `sha256` está presente, el nombre de archivo es `<sha256>.<ext>`, donde `<ext>` se extrae de la URL remota (`url.split("?")[0].split(".").pop()`, por defecto `mp3` para audio y `png` para ilustración). Si `sha256` es `null`, el nombre es `url_<normalizada>.<ext>`, donde `<normalizada>` es la URL sin query ni fragmento, con caracteres no alfanuméricos reemplazados por `_` y truncada a 120 caracteres. El cambio de `wordId` a contenido es total en escritura; la lectura conserva compatibilidad (ver abajo).
- **Compatibilidad de lectura (doble lookup, una versión):** `exists` y la resolución en `ficha/[id].tsx` consultan primero la ruta por contenido y, solo si no existe, la ruta heredada por `wordId` (`localAudioPath`/`localIllustrationPath` actuales). Ante acierto heredado, se programa migración perezosa (copia al nombre por contenido en background, sin bloquear reproducción). No se escribe nunca en la ruta heredada.
- **Poblado:** tras sincronización exitosa de contenido, el llamador invoca `buildManifest` con las palabras sincronizadas más `extra` (palabra del día y cursos; ver sección 3) y luego `ensureCached` por cada fila, con concurrencia acotada (límite 4 descargas simultáneas, reintentos 2 con espera 1000 ms). El poblado nunca se ejecuta tras una sincronización fallida o incompleta.
- **Poda:** `prune` elimina archivos locales cuyo nombre no figure en el manifiesto vigente. Restricciones: jamás podar durante una sincronización incompleta o fallida; jamás podar un archivo referenciado por una palabra marcada como favorita aunque no figure en el manifiesto (ver caso borde 6.4).
- `audio.ts` e `illustrations.ts` se conservan como adaptadores delegando en `MediaCache` (responde a R2: el consumo de audio permanece tras un adaptador sustituible por `expo-audio` en el futuro). Sus firmas públicas no cambian en B3; internamente resuelven por contenido con fallback heredado.
- Tabla `media_manifest` en SQLite (ver sección 2.2) y espejo en memoria en `MemoryWordStore` o estructura dedicada `MemoryMediaManifest` para tests.

### 1.4 Fase B4 — Endurecimiento + especificación del mini-change backend F1-a

B4 no agrega funciones de producto; produce:

1. Política de `outbox` documentada y aplicada (sección 4), con constantes:

```typescript
export declare const OUTBOX_MAX_PENDING = 500;
export declare const OUTBOX_PAYLOAD_MAX_BYTES = 4096;
```

2. Adaptador de audio (desacopla `expo-av`; sin migrar a `expo-audio`):

```typescript
export interface AudioPlayer {
  load(uri: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  unload(): Promise<void>;
}
export declare function createAudioPlayer(): AudioPlayer;
```

3. Especificación del campo `sha256` para el mini-change backend (sección 2.3), entregada como change separado del backend. La app ya lo consume de forma tolerante desde B3 (presente → clave por hash; ausente → fallback URL).

---

## 2. Esquemas y claves

### 2.1 Claves kv (unificadas)

| Clave | Contenido | Escritor | Lector |
|---|---|---|---|
| `piiyaak:lastSync` | ISO-8601 `serverTime` (cursor incremental) | `setLocalVersion` / `setLastSync` (heredado) | `incrementalSync` (`since`), UI ajustes |
| `piiyaak:contentVersion` | **NUEVA.** Cadena opaca de versión de contenido (comparación por igualdad exacta, sin orden) | `setLocalVersion` | gate en `syncNow` |
| `wodDate` / `wodId` | Caché de palabra del día (sin cambios) | flujo word-of-day | `src/app/index.tsx` |
| `seedPage` / `seedApplied` | Progreso de `fullSeed` reanudable (sin cambios) | `fullSeed` | `fullSeed` |
| `schemaVersion` | Versión de esquema (`"3"` → `"4"`) | `SQLiteWordStore.open` | diagnóstico |

Reglas:

- `piiyaak:lastSync` y `piiyaak:contentVersion` se escriben de forma conjunta al finalizar una sincronización exitosa. Si cualquiera de las dos escrituras falla, la sincronización se considera no confirmada y el próximo arranque repite el gate (no se confirma versión sin cursor ni cursor sin versión).
- Comparación de versión por **igualdad exacta de cadena**. No se interpreta orden ni formato semántico; una versión remota mayor, menor o con formato distinto se trata igual: diferencia → sincronizar (ver caso borde 6.1 para el subcaso remoto-menor).
- Corrección de sembrado (cierra R3): `scripts/export-db.py` debe sembrar `piiyaak:lastSync` (con prefijo, formato idéntico al que lee el código) y `piiyaak:contentVersion` correspondiente al contenido empaquetado. El sembrado actual escribe `lastSync` sin prefijo y `schemaVersion "3"`; ambos puntos se corrigen (ver sección 2.2).

### 2.2 Cambios de esquema v3 → v4

`SCHEMA_VERSION` pasa de `"3"` a `"4"`. Migración en `SQLiteWordStore.open`, **aditiva y sin pérdida**:

```sql
-- v4: manifiesto de medios + staging de cursos (staging solo si se elige opción S en B2)
CREATE TABLE IF NOT EXISTS media_manifest (
  word_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio','illustration')),
  url TEXT NOT NULL,
  sha256 TEXT,
  local_uri TEXT NOT NULL,
  PRIMARY KEY (word_id, kind)
);
```

- Las tablas `words`, `courses`, `modules`, `lessons`, `course_progress`, `outbox`, `history`, `kv` no se recrean ni se vacían. La migración preserva favoritas (AsyncStorage `piiyaak:favs`, fuera de SQLite), historial (tabla `history`), progreso (tabla `course_progress`) y `outbox` pendiente.
- Columnas `audioSha256` / `illustrationSha256` en `words`: se agregan si el mini-change F1-a se despliega durante la ventana de B3; si la app debe operar antes, los hashes viven únicamente en `media_manifest` (poblado desde el payload cuando existe, desde URL cuando no). La spec **no exige** columnas nuevas en `words` como condición de B3; el manifiesto es la fuente de verdad del caché.
- Si B2 elige opción S, la migración v4 incluye además `courses_staging`, `modules_staging`, `lessons_staging` con idéntica definición que sus contrapartes, más `DROP TABLE` de staging tras el primer swap exitoso (no se conservan tablas huérfanas).
- `MemoryWordStore` replica `media_manifest` en memoria (mapa por `wordId + kind`) y expone los mismos métodos que la implementación SQLite utilice internamente (`upsertManifest`, `listManifest`, `clearManifestStale`), de modo que los tests de B3 corren sin SQLite.
- Cualquier `PRAGMA` o `ALTER TABLE` adicional debe ser aditivo. Queda prohibido `DELETE FROM words|courses|history|course_progress|outbox` en código de migración.

### 2.3 Formato del campo `sha256` (mini-change backend F1-a)

La app (B3) consume el campo de forma tolerante; el backend lo produce en un change separado. Contrato que B4 debe entregar como especificación del mini-change:

- **Qué endpoint lo devuelve:** `GET /api/sync` y `GET /api/sync/seed`, a nivel de cada palabra. Campos: `audioSha256: string | null` e `illustrationSha256: string | null` (nombres exactos; `null` cuando la palabra no posee ese medio). No se modifica `/api/sync/full`, `/api/sync/version` ni autenticación.
- **Formato:** hexadecimal minúsculo del digest SHA-256 calculado sobre los **bytes del archivo del medio** (no sobre la URL ni metadatos), 64 caracteres `[0-9a-f]{64}`.
- **Validaciones de contrato del mini-change:** prueba que verifica formato del campo en ambas respuestas; prueba que verifica estabilidad (mismo bytes → mismo hash en llamadas sucesivas); prueba que verifica `null` ante medio ausente.
- **Fallback URL mientras tanto (F1-b transitorio):** si el payload no incluye `*_sha256`, la app deriva la clave de la URL normalizada (sección 1.3) y la poda contra manifiesto opera igual. El fallback queda como ruta documentada con eliminación programada una vez desplegado F1-a. Si F1-a resultara inviable, F1-b solo es aceptable como estado permanente con regla contractual explícita en backend: prohibidas las sobrescrituras in-place (todo reemplazo de medio genera URL nueva).

---

## 3. Alcance del parser de referencias de medios

`MediaCache.buildManifest(words, extra)` extrae referencias de medios de las siguientes fuentes, en este orden. Todo lo no listado queda **excluido**.

### 3.1 Fuentes cubiertas

1. **Palabras (`WordRow[]`):** campos `audioUrl` y `illustrationUrl` de cada palabra con `status === "PUBLISHED"`. Palabras `DRAFT` se excluyen del manifiesto (coherente con el filtrado existente en `search`/`listAZ`).
2. **Palabra del día:** `audioUrl`/`illustrationUrl` de la palabra resuelta por `wodId`, agregada vía parámetro `extra` aunque ya figure en `words`.
3. **Bloques de lección (contenido JSON de `lessons.content`):**
   - bloque `type: "audio"`: `(block.media as { url?: string }).url`
   - bloque `type: "listening"`: `(block.media as { url?: string }).url`
   - bloque `type: "image"`: `block.url`
   - Cada referencia se registra con `wordId: "lesson:<lessonId>"` y `kind` según tipo (`audio` para audio/listening, `illustration` para image).
4. **Portadas de curso:** `coverImage` de cada `CourseRow` con `status === "PUBLISHED"`, registrada con `wordId: "course:<courseId>"`, `kind: "illustration"`.

### 3.2 Exclusiones explícitas

- `youtubeId` / bloques `type: "video"`: el contenido de video remoto no se descarga ni se manifiesta. La app conserva el comportamiento actual (enlace/título remoto). Justificación: tamaño impredecible y restricciones de hotlink/TOS; el manifiesto solo cubre medios servidos como archivo descargable por la plataforma.
- Bloques `type: "text"` / `RichTextBlock`: el parser de rich-text actual (`src/lib/rich-text`) no produce nodos de medios; no se extrae nada de HTML/rich-text en B3. Si un futuro bloque `text` incluyera `<img>` o `<audio>`, requiere extensión explícita de esta spec.
- Bloques `word` / `vocabulary` / `quiz`: referencian palabras por id; sus medios quedan cubiertos por la fuente 1, no se duplican.
- URLs con esquema distinto de `https:` (o `http:` en desarrollo local) se rechazan en validación y no ingresan al manifiesto.

### 3.3 Validación de cada referencia

Antes de ingresar al manifiesto, cada URL candidata pasa validación Zod en el borde. Referencia inválida se omite y se contabiliza (`{ skipped: number }` en el resultado de `buildManifest`), sin abortar la sincronización:

```typescript
export const MediaUrlSchema = z.string().url().startsWith("https://");
```

---

## 4. Política de drenaje de outbox sin sesión

Estado actual: `flushOutbox` y `flushCourseProgress` retornan sin operar ante `session = null`; `pushHistory` y el toggle de lección acumulan en `outbox` sin sesión; `db-context` drena al iniciar sesión, al pasar a foreground y vía `syncData`.

Política normativa B4 (documenta R8 sin rediseñar el mecanismo):

1. **Acumular sin sesión, sin pérdida:** toda escritura sin sesión (favorita, historial local, `course_progress`) se registra en `outbox` con su payload íntegro. Ninguna ruta descarta entradas por falta de sesión. `flushOutbox(store, null)` y `flushCourseProgress(store, …, null)` conservan su no-operación actual; la no-operación es comportamiento especificado, no omisión.
2. **Drenar al iniciar sesión, en orden FIFO:** al establecerse `session` (efecto existente en `db-context` sobre `session?.user?.id`), drenar `pendingOutbox()` en orden ascendente de `id`. Cada entrada se marca sincronizada **solo** ante respuesta `ok` del servidor. Fallo de red o respuesta no-ok deja la entrada pendiente para el siguiente intento. Nunca se marca en lote.
3. **Idempotencia por clave:** las operaciones de favoritas se drenan como estado convergente (la última operación por `wordId` prevalece; entradas intermedias contradictorias del mismo `wordId` se colapsan antes del envío). Historial y progreso se drenan íntegros (cada vista/completitud cuenta; no se colapsan).
4. **Límites:** si `pendingOutbox()` supera `OUTBOX_MAX_PENDING` (500), las escrituras nuevas se rechazan con error visible al usuario ("cambios pendientes de sincronizar; inicie sesión") en lugar de crecimiento ilimitado. Payloads que superen `OUTBOX_PAYLOAD_MAX_BYTES` (4096) se rechazan en `addOutbox`. Estos límites son nuevos en B4 y requieren tests.
5. **Doble drenaje:** `flushOutbox` se invoca desde login, foreground y `sync()`; al ser idempotente por entrada (marca individual ante `ok`), las invocaciones concurrentes no duplican efectos observables en servidor para favoritas (colapso por clave) y son aceptables para historial/progreso.
6. **Sin sesión prolongada:** el contador `pendingOutboxCount` ya expuesto por el contexto se muestra en ajustes (existente). B4 no agrega UI; documenta que el usuario sin sesión acumula hasta el límite y el login drena.

---

## 5. Matriz de pruebas

Principios (skill `test-driven-development-tdd`): cada test nuevo se escribe primero, se observa fallar por la razón esperada y luego se implementa el mínimo código que lo pone en verde. Los tests usan código real (`MemoryWordStore`, `MemoryCourseStore`, `fetch` mockeado); los mocks se limitan a la frontera nativa (`expo-file-system`, red).

Infraestructura de mocks (a crear en B1/B3, inexistente hoy):

```typescript
// Patrón exigido para FileSystem (no existe mock actual; R6):
// vi.mock("expo-file-system", () => ({ ... })) con tienda en memoria:
// getInfoAsync, makeDirectoryAsync, downloadAsync, deleteAsync,
// readDirectoryAsync/documentDirectory. Ningún test de medios toca disco real.
```

| CA | Test(s) que lo cierran | Mecanismo | Fase |
|---|---|---|---|
| CA1 Arranque offline | `arranque offline con fetch bloqueado resuelve bundle sin red` | `fetch = vi.fn(rechaza todo)`; store sembrado con palabras/categorías/cursos; `syncNow` no invoca red; `search`/`listAZ`/`getCourses` responden desde store | B1 |
| CA1 | `bundle con lastSync sin prefijo dispara fullSeed (regresión R3)` | Siembra con clave `lastSync` sin prefijo; verifica que el gate no la reconoce y solicita red (documenta el defecto que B1 corrige) | B1 |
| CA2 Gate de versión | `versión igual omite /api/sync` | `contentVersion` local == remota mockeada; `fetch` espía confirma cero llamadas a `/api/sync` y `/api/sync/seed`; retorna `applied: 0` | B1 |
| CA2 | `versión distinta sincroniza y actualiza ambas claves` | Versión distinta; verifica llamada a sync, `piiyaak:lastSync` + `piiyaak:contentVersion` escritas conjuntamente | B1 |
| CA2 | `instalación sin contentVersion hace sync completa una vez` | kv sin `contentVersion` pero con `lastSync`; verifica `fullSeed` y adopción posterior del gate | B1 |
| CA3 Lectura sin sesión | `syncCourses con authToken null no envía Authorization` | `fetch` espía; `session = null`; verifica ausencia de encabezado `Cookie`/`Authorization` y éxito | B1 |
| CA3 | `sync/incremental con authToken null completa` | Igual mecanismo sobre `incrementalSync` | B1 |
| CA4 Atomicidad | `fallo inyectado a mitad de syncCourses conserva contenido previo` | `MemoryCourseStore` con datos; `fetch` falla en el detalle del segundo curso; verifica conteo y muestra idénticos antes/después | B2 |
| CA4 | `rollback ante fallo en upsert (transacción)` | Falla `upsertLesson` a mitad; verifica `runInTransaction` revierte (snapshot en memoria) | B2 |
| CA5 Media-cache | `sync exitosa puebla medios del manifiesto` | Mock FileSystem en memoria; verifica archivos por contenido existen tras sync | B3 |
| CA5 | `segunda sync con manifiesto reducido poda huérfanos y conserva referenciados` | Manifiesto v1 → v2 reducido; verifica eliminados vs conservados | B3 |
| CA5 | `sha256 ausente usa fallback por URL` | Payload sin `*_sha256`; verifica clave derivada de URL normalizada | B3 |
| CA5 | `doble lookup: heredado por wordId migra perezosamente` | Archivo heredado existente; verifica resolución y copia a clave por contenido | B3 |
| CA6 word-of-day anónimo | `sin sesión retorna contenido sin escribir historial remoto` | `session = null`; `fetch` mockeado para word-of-day; verifica contenido y cero llamadas a `/api/dictionary/history` | B1 |
| CA6 | `con sesión registra historial` | `session` presente; verifica llamada a historial | B1 (test de no-regresión) |
| CA7 Sin regresión escrituras | `favoritas/historial/progreso exigen sesión; outbox drena al login` | Tests existentes `flushOutbox` + nuevos de colapso por clave y límites (sección 4) | B4 |
| CA8 Suite verde | `tsc --noEmit` + linter + suite en verde | CI; incluye nuevos mocks FileSystem | B4 |

Cobertura existente que se reutiliza sin modificar semántica: `sync.test.ts` (reintentos, 401, deltas, seed paginado), `store.test.ts` (ranking, DRAFT, seed/incremental con `session = null` — estos últimos ya anticipan el contrato B1), `outbox.test.ts` (round-trip outbox/historial).

### Explícitamente sin cubrir (sin dispositivo físico)

- Descarga real de bytes de medios, reproducción de audio en altavoz, rendimiento de poda masiva en almacenamiento real, migración sobre BD de usuario real instalada, comportamiento ante corte de red a nivel socket (los tests simulan fallo a nivel `fetch`/inyección, no a nivel transporte), firma/distribución del APK, `expo-file-system` v18 fuera del mock, `expo-av` en hardware.

---

## 6. Casos borde

### 6.1 Bundle con `contentVersion` mayor que la del servidor

Situación: el bundle empaquetado contiene contenido más nuevo que el que expone `/api/sync/version` (despliegue de backend revertido o bundle generado desde un entorno adelantado).

- El gate compara por igualdad: diferencia → intenta sincronizar. La sincronización resultante aplica deltas del servidor (posiblemente vacíos o más antiguos por `updatedAt`) y **adopta la versión remota**, es decir, el contenido local puede retroceder a la versión del servidor.
- Esto es comportamiento especificado (la autoridad es siempre el servidor; `lastSync` es cursor, no criterio de frescura), no corrupción: el contenido resultante es autoconsistente con la versión declarada. No se implementa retención de contenido más nuevo ni bifurcación de versiones en este change.
- Salvaguarda: `setLocalVersion` escribe versión + cursor conjuntamente, de modo que nunca queda una versión nueva con cursor viejo ni viceversa. El caso queda registrado en B4 como limitación conocida con recomendación operativa (no revertir backend sin regenerar bundle).

### 6.2 Sync a mitad con corte de red

- **Contenido (`syncNow`):** `incrementalSync` aplica por página (`upsertWords` + `removeWords`) y solo escribe `lastSync` al completar todas las páginas. Un corte a mitad deja aplicadas las páginas ya descargadas pero conserva el cursor anterior; la próxima sincronización repite desde el cursor anterior (reaplicación idempotente por `upsert`, sin duplicados). `fullSeed` conserva su reanudación por `seedPage`/`seedApplied` (existente) con la corrección de que al finalizar escribe ambas claves vía `setLocalVersion`.
- **Cursos (`syncCourses`):** corte durante el `refetch` dispara `ROLLBACK` (opción U) o descarte de staging (opción S). El contenido previo queda intacto (O4/CA4). No se escribe `contentVersion` ni cursor tras fallo.
- **Medios:** el poblado solo corre tras sincronización exitosa; un corte durante la descarga deja archivos parciales que `ensureCached` reintenta (descarga completa, sin resume) y que la poda nunca toca hasta el próximo manifiesto vigente.

### 6.3 Hash mismatch

Situación: el archivo descargado no coincide con el `sha256` declarado (corrupción en tránsito, CDN que transforma bytes, o F1-b con URL reutilizada).

- `ensureCached` verifica integridad post-descarga **solo** cuando el manifiesto incluye `sha256` (modo F1-a): calcula el digest de los bytes descargados y lo compara con el declarado. Ante mismatch: elimina el archivo parcial, reintenta una vez; si persiste, registra la referencia como `failed` (no bloquea la sync de contenido) y la reporta en el resultado (`{ failed: MediaRef[] }`).
- En modo fallback (sin `sha256`), no hay verificación posible; el riesgo aceptado es el documentado en F1-b (caché envenenada silenciosa ante sobrescritura in-place), mitigado por la regla contractual de no sobrescritura.
- Un mismatch persistente en modo F1-a indica defecto de backend o de CDN y no se silencia: la entrada permanece en `failed` y la próxima sync la reintenta.

### 6.4 Poda con favoritos (no podar lo favoriteado aunque salga del manifiesto)

- La poda (`prune`) recibe, además del manifiesto vigente, el conjunto de ids favoritos (`piiyaak:favs` de AsyncStorage). Todo archivo local cuya `wordId` figure en favoritos se conserva aunque su hash ya no figure en el manifiesto.
- Justificación: la favorita es señal explícita de intención offline del usuario (comportamiento heredado de `toggleFavorite` que descargaba al favoritar). Podar un medio favoriteado rompería reproducción offline sin acción del usuario.
- Al desfavoritar, la protección cesa; la próxima poda puede eliminar el archivo si no está referenciado. Este es el único camino por el que un medio favoriteado sale del caché sin cambio de manifiesto.
- El historial (`history`) no otorga protección de poda; solo favoritas.

---

## 7. Archivos afectados (resumen normativo)

| Archivo | Cambio | Fase |
|---|---|---|
| `src/db/sync.ts` | Gate de versión, `session: null` en lectura, escritura conjunta de claves | B1 |
| `src/db/version-gate.ts` | **Nuevo** (opcional; alternativa: dentro de `sync.ts`) | B1 |
| `src/db/sqlite-store.ts` | `SCHEMA_VERSION "4"`, migración aditiva, tabla `media_manifest`, espejo en memoria | B1/B3 |
| `src/db/memory-store.ts` | Espejo de `media_manifest`, `contentVersion` vía kv genérico | B1/B3 |
| `src/db/sync-courses.ts` | Elimina `clear+refetch`; upsert/swap transaccional; `session: null` | B2 |
| `src/db/course-store.ts` | `remove*`, `list*Ids`, `runInTransaction`; `MemoryCourseStore` con rollback | B2 |
| `src/db-context.tsx` | Conexión única expuesta; elimina aperturas separadas en pantallas | B2 |
| `src/app/cursos/*.tsx` | Consumen store del provider; sin `openDatabaseSync` propio | B2 |
| `src/db/media-cache.ts` | **Nuevo**: `MediaStore`, `MediaCache`, `buildManifest`, `prune` | B3 |
| `src/audio.ts`, `src/illustrations.ts` | Delegan en `MediaCache`; doble lookup; migración perezosa | B3 |
| `src/app/ficha/[id].tsx` | Resolución por contenido con fallback heredado | B3 |
| `src/app/index.tsx` | `fetchWordOfDay(date, null)`; sin exigencia de sesión | B1 |
| `src/app/cursos/leccion/[id].tsx` | Sin apertura propia de BD (usa provider) | B2 |
| `scripts/export-db.py` | Siembra `piiyaak:lastSync` + `piiyaak:contentVersion` + `schemaVersion "4"` | B1 |
| `src/db/*.test.ts`, `src/db/media-cache.test.ts` | Matriz de sección 5; mocks FileSystem desde cero | B1–B4 |

---

## 8. Criterios de aceptación (trazabilidad a la propuesta)

CA1–CA8 de la propuesta §9 se verifican con los tests de la matriz §5. Ningún CA requiere dispositivo físico. El change se considera terminado cuando `tsc --noEmit`, el linter del proyecto y la suite completa están en verde, incluyendo los nuevos mocks de FileSystem.
