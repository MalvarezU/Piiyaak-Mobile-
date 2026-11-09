# Propuesta — `apk-offline-fase-b-app`: app offline-first con endpoints públicos

- **Change ID:** `apk-offline-fase-b-app`
- **Rama de trabajo:** `feat/mobile-offline-fase-b`
- **Estado:** propuesta (sin implementación)
- **Idioma:** español neutro/profesional
- **Backend requerido:** Fase A+B ya desplegado (no se modifica en este change, salvo eventual mini-change F1-a)

---

## 1. Problema

La aplicación móvil no es utilizable sin conexión ni sin sesión, aunque el backend ya expone el contenido publicado sin autenticación:

1. El primer arranque exige red: el bundle siembra `lastSync` sin el prefijo esperado por el código (`piiyaak:lastSync`), lo cual provoca un `fullSeed` por red en lugar de utilizar el contenido incluido en el paquete.
2. No existe `contentVersion` en el cliente; cada sincronización decide por fecha (`lastSync`) y no por versión de contenido, por lo que no es posible un gate barato y determinista.
3. Los medios (`audioUrl`, `illustrationUrl`) son remotos y el caché local solamente se puebla al marcar favoritas (`audio.ts` e `illustrations.ts`, clave `wordId`, sin hash y sin poda). Una palabra nunca favorita no dispone de audio ni ilustración sin conexión.
4. `word-of-day` requiere sesión, de modo que una función de lectura diaria queda bloqueada para el usuario anónimo.
5. `syncCourses` ejecuta `clear + refetch` total sin transacción: ante un fallo de red a mitad del proceso, el usuario pierde el contenido local que ya poseía.
6. Los cursos abren su propia instancia SQLite, separada del resto del store, lo cual impide una sincronización atómica y aumenta el riesgo de estados divergentes.
7. La zona de medios carece de pruebas (FileSystem sin mocks) y el `outbox` acumula escrituras sin sesión sin una política explícita de drenaje diferido.

El resultado es una app online-first con puntos de fallo silenciosos en condiciones de conectividad intermitente, que es el escenario principal de uso en campo.

## 2. Objetivo medible

Al finalizar este change, la aplicación deberá cumplir:

- **O1 — Offline desde el primer arranque:** con el dispositivo en modo avión tras la instalación, la app abre y presenta el contenido incluido en el bundle (palabras, categorías y cursos semilla) sin realizar ninguna llamada de red. Verificable con test de arranque con `fetch` bloqueado.
- **O2 — Sync sin login:** con conectividad y sin sesión iniciada, la app consulta `GET /api/sync/version`, compara `contentVersion` y actualiza el contenido publicado mediante `/api/sync` o `/api/sync/seed`. Ninguna lectura de contenido publicado exige token. Verificable con test de `syncCourses`/`sync` con `authToken = null`.
- **O3 — Medios con caché determinista:** al menos el conjunto manifiesto (palabras del bundle + palabra del día) dispone de audio e ilustración en caché tras la primera sincronización con red, y la poda posterior no elimina archivos referenciados por el manifiesto vigente. Verificable con mocks de FileSystem.
- **O4 — Sin pérdida ante fallo:** una sincronización de cursos interrumpida (error de red a mitad del `refetch`) conserva intacto el contenido previo. Verificable con test de fallo inyectado.

Criterio de éxito global: los cuatro objetivos se verifican en suite de pruebas sin dispositivo físico.

## 3. Alcance

### Dentro del alcance

- Persistir `contentVersion` en el almacenamiento kv junto a `lastSync`, y utilizar `GET /api/sync/version` como gate previo a cualquier sincronización de contenido.
- Permitir sincronización de lectura sin sesión (pasar `null` como token en llamadas de lectura; el token solamente se adjunta en escrituras: favoritas, historial, progreso).
- Corregir el sembrado inicial: el bundle debe sembrar `piiyaak:lastSync` (con prefijo) y, si aplica, `contentVersion` inicial, de modo que el primer arranque no dispare `fullSeed` por red.
- Evolucionar `media-cache` (audio e ilustraciones) de clave por `wordId` a clave por contenido, con poda contra manifiesto vigente.
- Reemplazar `syncCourses` con `clear` destructivo por una estrategia sin pérdida (upsert en transacción o reemplazo atómico con tabla temporal + swap).
- Unificar el acceso SQLite para cursos dentro de la instancia principal (o documentar la barrera transaccional si la unificación se difiere a una tarea explícita).
- Desbloquear `word-of-day` para usuario anónimo (lectura pública; la persistencia de historial permanece sujeta a sesión).
- Cobertura de pruebas con `MemoryWordStore` + `fetch` mockeado + mocks de FileSystem para la zona de medios.

### Fuera del alcance (no-alcance explícito)

- **Fase C (semilla/APK):** generación de semilla empaquetada nueva, firma y distribución del APK quedan fuera de este change.
- **Upgrade de SDK:** `expo-file-system` v18 y `expo-av` 16 permanecen pineados; no se actualiza Expo SDK ni se migra a `expo-audio`/`expo-video` en este change.
- **Autenticación:** el login continúa siendo obligatorio para favoritas, historial y progreso. No se modifica el modelo de autenticación ni el `outbox` más allá de documentar su drenaje diferido con sesión.
- **Backend:** no se toca `/api/sync/version`, `/api/sync`, `/api/sync/seed` ni `/api/sync/full`, con la única excepción del eventual mini-change F1-a (campo `sha256`, ver sección 5).
- **Cambios visuales:** no se rediseñan pantallas; las pantallas continúan leyendo del store local.

## 4. Decisiones ya cerradas (no reabrir)

| # | Decisión | Justificación |
|---|----------|---------------|
| D1 | Los endpoints de lectura (`/api/sync/version`, `/api/sync`, `/api/sync/seed`) son públicos, limitados a contenido `PUBLISHED` | El contenido didáctico es público por producto; la autenticación solamente protege escrituras de usuario |
| D2 | Login obligatorio solo para escrituras (favoritas, historial, progreso) | Separa lectura pública de datos personales; habilita O2 sin rediseñar auth |
| D3 | Poda de medios contra manifiesto vigente | Evita crecimiento ilimitado del caché sin riesgo de eliminar activos en uso; el manifiesto es la única fuente de verdad de referencias |

## 5. Diseño propuesto

### 5.1 Gate de versión (`contentVersion` + `/api/sync/version`)

- Almacenar en kv: `piiyaak:lastSync` (existente, corregir sembrado) y `piiyaak:contentVersion` (nuevo).
- Flujo de sincronización de lectura:
  1. `GET /api/sync/version` sin token → `{ contentVersion }`.
  2. Si `contentVersion` local == remota, omitir sincronización (ahorro de ancho de banda; análogo al patrón de validación condicional `ETag`/`If-None-Match` de la skill `api-design-patterns`).
  3. Si difiere, `GET /api/sync?since=<lastSync>` o `/api/sync/seed` según caso, con `contentVersion` top-level en la respuesta; aplicar cambios y actualizar ambas claves kv de forma atómica.
- El `contentVersion` remoto es la autoridad; `lastSync` permanece como cursor incremental, no como criterio de frescura.
- Transición: clientes sin `contentVersion` (instalaciones previas) realizan una sincronización completa una vez y adoptan el gate desde entonces.

### 5.2 Sync sin sesión (token `null`)

- Las funciones de lectura aceptan `authToken: string | null`; con `null` omiten el encabezado `Authorization` en lugar de lanzar error o redirigir a login.
- Regla de separación de concerns (`react-native-patterns`): el estado de servidor (contenido publicado) se sincroniza sin sesión; el estado personal (favoritas, historial, progreso) conserva el requerimiento de sesión y continúa acumulándose en `outbox` para drenaje diferido.
- `word-of-day` pasa a lectura pública; si existe sesión, adicionalmente registra historial; sin sesión, muestra el contenido sin registrar.
- Ninguna llamada de lectura debe fallar con 401 ante token ausente; si el backend respondiera 401 en un endpoint declarado público, se trata como defecto de backend, no se parcha en el cliente con login forzado.

### 5.3 Media-cache por contenido + poda contra manifiesto

Estado actual: `audio.ts` e `illustrations.ts` con clave `wordId`, sin hash, sin poda, poblado solo al favoritar.

Estado propuesto:

- Clave de caché derivada del contenido del medio (hash), no del `wordId` (ver fork F1 en sección 6 para el origen del hash).
- Tabla o índice local `media_manifest`: `{ wordId, kind: 'audio' | 'illustration', url, hash, localUri }`.
- Política de poblado: al sincronizar, descargar los medios del manifiesto vigente (bundle + palabra del día + contenido publicado sincronizado, con límite configurable de concurrencia y reintentos).
- Política de poda: tras sincronización exitosa, eliminar archivos locales cuyo hash no figure en el manifiesto vigente; jamás podar durante una sincronización incompleta o fallida.
- Mantener compatibilidad de lectura con archivos existentes por `wordId` durante una versión (doble lookup: hash → fallback `wordId`), con migración perezosa.

### 5.4 `syncCourses` sin `clear` destructivo

- Eliminar la secuencia `clear + refetch`. Opciones aceptables (elegir una en la fase de spec):
  - **Upsert en transacción:** aplicar altas/modificaciones/bajas dentro de una transacción SQLite; ante fallo, rollback completo (conserva O4).
  - **Swap atómico:** escribir en tablas temporales/staging y renombrar al finalizar con éxito.
- Mientras los cursos residan en una instancia SQLite separada, la atomicidad queda limitada a esa instancia; por ello se propone unificar el acceso (ver 5.5).

### 5.5 Unificación SQLite

- Los cursos deben operar sobre la misma conexión SQLite que el resto del store, de modo que contenido y cursos participen de la misma transacción lógica de sincronización.
- Si la spec detecta un bloqueador (migración de datos existentes), se admite una tarea explícita de migración con doble apertura temporal, pero con fecha de cierre dentro de este change; no se acepta como estado permanente.

### 5.6 Corrección del sembrado inicial

- El bundle debe sembrar `piiyaak:lastSync` (con prefijo, formato idéntico al que lee el código) y `piiyaak:contentVersion` inicial correspondiente al contenido empaquetado.
- El primer arranque con red disponible debe seguir el gate normal (comparar versión, sincronizar solo si difiere); sin red, operar con el bundle sin error.

## 6. Fork F1 — Origen del hash del medio [NUEVO]

**Pregunta:** ¿de dónde obtiene la app el hash del medio para la clave de caché por contenido?

### Opción (a) — El backend agrega `sha256` al payload de sync/seed por palabra

- Cada palabra incluiría `audioSha256` / `illustrationSha256` (o un objeto `media` con hashes) en `/api/sync` y `/api/sync/seed`.
- **Ventajas:** determinista y robusto; la app no necesita descargar para conocer el hash; habilita validación de integridad post-descarga; inmune a sobrescrituras in-place; alinea con el principio de diseño de API de exponer metadatos de validez junto al recurso.
- **Costos:** reabre el backend declarado archivado como mini-change (migración o cómputo al vuelo + pruebas de contrato). Riesgo de alcance si el cómputo de hashes sobre activos existentes resulta costoso.

### Opción (b) — Detección de cambio por URL

- La app deriva la clave de la URL remota (`audioUrl`/`illustrationUrl`). Dado que cada carga genera una clave nueva con timestamp/uuid, un cambio de URL equivale a cambio de contenido.
- **Ventajas:** cero cambios de backend; funciona de inmediato con el backend actual.
- **Riesgos:** frágil ante sobrescritura in-place (misma URL, distinto bytes → caché envenenada permanente); acopla la corrección del caché a una convención actual del pipeline de subida, no a un contrato; impide validación de integridad.

### Recomendación: opción (a), con (b) como fallback transitorio

Se recomienda **(a)** como estado final: el hash en el payload convierte la invalidez del caché en un contrato explícito en lugar de una heurística sobre la forma de la URL. La fragilidad de (b) es silenciosa (contenido obsoleto sin error visible), mientras que el costo de (a) es acotado y puntual (un campo adicional por palabra en dos endpoints ya versionados por `contentVersion`).

Estrategia de transición compatible con backend archivado:

1. **Fase B-app:** implementar la clave por contenido aceptando `sha256` cuando exista y con fallback a URL normalizada cuando falte (comportamiento (b)). La poda contra manifiesto funciona en ambos modos.
2. **Mini-change backend (acotado):** agregar `sha256` a `/api/sync` y `/api/sync/seed` con pruebas de contrato; sin tocar `/api/sync/full` ni autenticación.
3. Una vez desplegado el mini-change, el fallback por URL queda como ruta muerta documentada y se programa su eliminación.

Si el mini-change backend resultara inviable, (b) es aceptable como estado permanente **solamente** con una salvaguarda contractual: documentar en el backend que las sobrescrituras in-place están prohibidas (los reemplazos de medios deben generar URL nueva), convirtiendo la convención actual en regla explícita.

## 7. Riesgos

| # | Riesgo | Impacto | Mitigación en este change |
|---|--------|---------|---------------------------|
| R1 | `expo-file-system` v18 legacy (API antigua, sin las utilidades de versiones recientes) | Errores de E/S o límites no documentados en poda/descarga masiva | Aislar FS tras una interfaz `MediaStore` testeable; concurrencia acotada; no upgradear en este change |
| R2 | `expo-av` 16 deprecado | Reproducción de audio puede romperse en futuros SDK; sin soporte | No migrar en este change; consumo de audio vía adaptador para sustitución futura por `expo-audio` |
| R3 | Key mismatch `lastSync` sin prefijo en bundle | Primer arranque hace `fullSeed` por red aunque exista bundle | Corregir sembrado (5.6) + test de arranque offline que falla si se regresa |
| R4 | `clearCourses` sin transacción | Pérdida de contenido ante fallo de red (viola O4) | Reemplazo por upsert/swap atómico (5.4) + test de fallo inyectado |
| R5 | Doble instancia SQLite (cursos separada) | Sincronización no atómica; divergencia entre stores | Unificación (5.5) o tarea de migración explícita con cierre en el change |
| R6 | Zona de medios sin pruebas (FileSystem sin mocks) | Regresiones silenciosas en caché/poda | Mocks de FileSystem + matriz de casos (éxito, fallo parcial, manifiesto vacío, hash ausente) |
| R7 | Divergencia URL vs bytes (si se adopta F1-b permanente) | Caché envenenada sin señal de error | Preferir F1-a; si F1-b, regla contractual de no sobrescritura in-place |
| R8 | `outbox` acumulado sin sesión | Crecimiento ilimitado / drenaje duplicado al iniciar sesión | Documentar política (límite + idempotencia por clave) sin rediseñar en este change |

## 8. Plan por fases (estimación)

| Fase | Contenido | Estimación |
|------|-----------|------------|
| B1 — Gate de versión | kv `contentVersion`, gate `/api/sync/version`, corrección de sembrado, sync lectura con token `null`, `word-of-day` anónimo. Tests: arranque offline, gate igual/diferente, lectura sin token. | 2–3 días |
| B2 — `syncCourses` atómico + SQLite | Reemplazo de `clear+refetch` por upsert/swap; unificación de instancia (o migración explícita). Tests: fallo inyectado a mitad de sync, atomicidad. | 2–3 días |
| B3 — Media-cache por contenido | Índice `media_manifest`, clave por hash con fallback URL, poblado en sync, poda contra manifiesto, doble lookup de compatibilidad. Tests con mocks de FileSystem. | 3–4 días |
| B4 — Endurecimiento y propuesta de mini-change backend | Política `outbox` documentada, adaptador de audio, matriz de pruebas completa, especificación del campo `sha256` (F1-a) como change separado. | 1–2 días |

**Total estimado:** 8–12 días de desarrollo y pruebas (sin dispositivo físico; sin Fase C; sin upgrade de SDK).

## 9. Criterios de aceptación (verificables sin dispositivo)

1. **CA1 — Arranque offline:** con `fetch` bloqueado (rechazo total) y bundle sembrado, la app resuelve palabras, categorías y cursos semilla desde el store local; ningún test realiza red.
2. **CA2 — Gate de versión:** con `contentVersion` local igual a la remota mockeada, no se invoca `/api/sync`; con versión distinta, se invoca y se actualizan `piiyaak:lastSync` + `piiyaak:contentVersion` de forma conjunta.
3. **CA3 — Lectura sin sesión:** `syncCourses` y `sync` con `authToken = null` completan contra `fetch` mockeado sin encabezado `Authorization` y sin lanzar error de autenticación.
4. **CA4 — Atomicidad:** fallo inyectado a mitad de `syncCourses` deja el contenido previo intacto (conteo y muestra idénticos antes/después).
5. **CA5 — Media-cache:** con FileSystem mockeado, tras sync exitosa los medios del manifiesto existen localmente; tras una segunda sync con manifiesto reducido, los archivos huérfanos se podan y los referenciados se conservan; con `sha256` ausente, el fallback por URL funciona.
6. **CA6 — `word-of-day` anónimo:** sin sesión, retorna contenido; con sesión, adicionalmente registra historial; sin sesión no se escribe historial ni se lanza error.
7. **CA7 — Sin regresión de escrituras:** favoritas/historial/progreso continúan exigiendo sesión y el `outbox` drena al iniciar sesión (comportamiento actual preservado).
8. **CA8 — Suite verde sin dispositivo:** `tsc --noEmit` + linter + suite de pruebas en verde en CI, incluyendo los nuevos mocks de FileSystem.

---

*Fin de la propuesta. Siguiente paso recomendado: `spec` detallada por fase (B1–B4) con contratos de funciones, esquemas kv y matriz de pruebas.*
