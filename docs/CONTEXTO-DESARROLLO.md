# Contexto de desarrollo — Piiyaak (backend + app móvil)

> Generado el 2026-11-11 tras la sesión Fase 2 + Fase 3 + migración SDK 55 + pipelines Cloudflare/R2.
> Esta es la referencia para continuar el proyecto en una sesión nueva.

---

## Repositorios

| Repo | URL | Rol |
|---|---|---|
| **DiccionarioNasa** | github.com/MalvarezU/DiccionarioNasa | Backend web (Next 16 + MariaDB + Prisma) + admin panel + pipelines |
| **Piiyaak-Mobile-** | github.com/MalvarezU/Piiyaak-Mobile- | App Expo SDK 55 (RN 0.83, React 19.2) |

**Producción:** `https://piiyaak.com` (backend Node en Hostinger + MariaDB). DB prod: `u357487330_piiyaakDB` (contentVersion **67**).

---

## Ramas y worktrees

### Backend (DiccionarioNasa)
| Rama | Estado |
|---|---|
| `main` | **Rama principal.** Actual: `fbf6083` (zod→dependencies). Incluye PR #5 (fase-a/b/c/d) + PR #6 (fix descarga + SW) |
| `develop` | Rama de desarrollo, sincronizada con main |
| `chore/hostinger-deploy-setup` | Work branch del deploy (Hostinger + workflows). Mergeada vía PR #5/#6 |
| `feat/etapa1-content-version`, `feat/f1a-sha256-sync`, `feat/fase-d-auto`, `feat/fase-c-seed`, `feat/fase-b-endpoints` | Ramas de fases (ya mergeadas) |
| `fase-a/pr1..pr3` | PRs cerrados (mergeados manualmente con resolución de conflictos) |
| `origin/develop` | Era la default; ahora `main` es la default (cambiado) |

**Worktrees backend:**
- `/home/mario/Escritorio/Proyectos/pyajte/Diccionario nasa` → `main` (ruta con espacio al final)
- `/home/mario/Escritorio/Proyectos/Diccionario-endpoints` → `feat/fase-d-auto`
- `/home/mario/Escritorio/Proyectos/Diccionario-etapa1` → `feat/etapa1-content-version`
- `/home/mario/Escritorio/Proyectos/Diccionario-f1a` → `feat/f1a-sha256-sync`
- `/home/mario/Escritorio/Proyectos/piiyaak-deploy` → `chore/hostinger-deploy-setup`

### Móvil (Piiyaak-Mobile-)
| Rama | Estado |
|---|---|
| `main` | Actual: `fd5c1f9` (workflow APK + scripts) |
| `feat/juegos`, `feat/mobile-consumo-completo`, `feat/mobile-fase-c`, `feat/mobile-fase-d`, `feat/mobile-offline-fase-b`, `feat/mobile-paridad-web` | Ramas de fases previas |
| `chore/limpieza-hostinger` | Limpieza |

---

## Fases completadas

### Fase 2 — Rediseño visual (app)
Kit UI (`src/components/ui/`: ThemedText, Card, Button, Chip, Screen) + Home (WOD card, módulos, búsqueda) + Ficha (dictionary card) + Explorar A-Z (letter headers) + Hub Juegos (lucide tiles). View-only, tokens de `src/theme.ts`.

### Fase 3 — Juegos + juice kit (app)
- **Relaciona**: two-column matching (palabras visibles, tap para unir). Reemplazó al juego "Memoria" (borrado).
- **Escucha**: audio + 4 opciones múltiples. 11 audios + 4 ilustraciones embebidas en el APK.
- **Completar**: pista de letras (35% ocultas).
- **Ordena**: texto visible, tiles centrados.
- **Juice kit**: `src/components/motion/` (Reveal, Pulse, Stagger) con Reanimated; consumido en Home/Explorar.
- **Cursos**: portada (ResumeBand, featured, search) + detalle (progress bar) + lección (evaluación: quiz interactivo, listening, word cards, video notice).

### SDK migration 52 → 55
`expo@55`, RN 0.83, React 19.2, Reanimated 4.2, `expo-av` → `expo-audio`, `expo-file-system` → `expo-file-system/legacy`, tests 235/235 verdes.

### Branding
Logo Piiyaak en header (`logo-white.png`) + tile Diccionario (`logo.png`), app icon = logo, login UI oculto tras `AUTH_UI_ENABLED=false`.

### Pipelines (backend)
- **`seed-content.yml`**: genera `seed/<N>/manifest.json` + `piiyaak-seed.zip` → R2. Disparadores: manual + **domingos 07:00 UTC (02:00 Colombia)**.
- **`apk-release.yml`** (repo móvil): descarga el seed, embebe DB+medios, compila APK, sube a R2 (`apk/<vc>/` + `apk/latest.json`). Disparadores: manual + **domingos 09:00 UTC (04:00 Colombia)**.
- **`deploy-hostinger.yml`**: build en runner → tar → SCP → restart. Disparador: manual (9 secrets).

---

## Pendientes (orden sugerido)

1. **`.env` de prod**: pegar `SEED_DISPATCH_TOKEN`, `SEED_GITHUB_OWNER/REPO`, `APK_DISPATCH_TOKEN`, `APK_GITHUB_OWNER/REPO` + confirmar `CI_SYNC_SECRET` y `R2_*`. Sin esto los 500 del admin persisten.
2. **Keystore de firma** (app): generar con `keytool -genkeypair ...`, base64 → secret `KEYSTORE_BASE64` + `KEYSTORE_PASSWORD`/`KEY_ALIAS`/`KEY_PASSWORD` en `Piiyaak-Mobile-`. Sin esto la APK sale debug-firmada.
3. **Primer seed real**: con prod deployado y `.env` listo → dispatch `seed-content.yml` (dry_run=false) → verificar `seed/<N>/` + `latest.json` en R2.
4. **Primer APK**: dispatch `apk-release.yml` (dry_run primero) → APK en R2 + `apk/latest.json`.
5. **Dashboard**: botón "Publicar APK" ya está en `admin/palabras` (modal `ApkDispatchModal`).
6. **SW residual**: el error `Failed to convert value to 'Response'` en `/admin/palabras` (bypass `.apk` ya aplicado; si persiste, revisar el handler del SW en `/admin`).
7. **Aviso de nueva versión** en la app (consultar `apk/latest.json` al arrancar).
8. **Maestro E2E** (`.maestro/*.yaml` ya creados; requieren un runner).
9. **⚠️ Backlog JUEGOS (actualizado 2026-11-11, sesión v1.3)**:
   - ✅ **FIXED app**: pools de `flashcards`/`relacionar`/`ordena`/`completar` usaban `listAZ(null,50,0)` (siempre las primeras 50 alfabéticas de 357) → ahora `listRandom(50)` (muestreo aleatorio total). Escucha app: revelado con palabra Nasa Yuwe + pronunciación + reescuchar al responder, re-baraja al reintentar y distractores del pool completo.
   - ✅ **FIXED web**: `/api/games/words` ya era aleatoria pero el muestreo chico (12 de ~31 audios) daba enorme solapamiento → helpers de `game-words.ts` ahora **excluyen palabras servidas recientemente** (ring buffer `piiyaak:game:v1:recent`, cap 24, compartido entre juegos) y Escucha muestrea 16; si el pool filtrado queda <4 reintenta sin exclusión. El revelado web de Escucha ya existía (verificar en prod).
   - ⏳ **PENDIENTE (dueño: "para más adelante")**: modo infinito con vidas en los juegos — **definir cuántos intentos/vidas** antes de terminar (preguntado el 2026-11-11; aún sin respuesta).

---

## Variables de entorno (backend prod)

```bash
# Base
DATABASE_URL="mysql://...@host:3306/u357487330_piiyaakDB"
NEXTAUTH_SECRET, NEXTAUTH_URL="https://piiyaak.com"
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
ADMIN_EMAIL/PASSWORD/NAME
CI_SYNC_SECRET=18fad2fded9562819481eee298c3d79223662761a0214d29bb5d722a8454b8d3

# R2 (medios + semillas + APK)
R2_ACCOUNT_ID=1b0f488650121b288ca19d39d05aac6d
R2_ACCESS_KEY_ID=dee0f4d467d2da5345732f84e9f9581f
R2_SECRET_ACCESS_KEY=029f12f6fc35978641ebf130d39d1a54db5e69c139488e5d1db5629c2294ed4c
R2_BUCKET=ilustraciones-piiyaal-test        # ⚠️ test; usar bucket real de prod
R2_PUBLIC_BASE_URL=https://pub-cc9e53869548453a91a0d518d085a6c4.r2.dev

# Dispatch (PATs server-only)
SEED_DISPATCH_TOKEN=github_pat_...
SEED_GITHUB_OWNER=MalvarezU
SEED_GITHUB_REPO=DiccionarioNasa
APK_DISPATCH_TOKEN=github_pat_...
APK_GITHUB_OWNER=MalvarezU
APK_GITHUB_REPO=Piiyaak-Mobile-
```

## Secrets GitHub

**DiccionarioNasa** (Actions): `CI_SYNC_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` ✅
**Piiyaak-Mobile-** (Actions): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`, `EXPO_PUBLIC_API_URL=https://piiyaak.com`, `EXPO_PUBLIC_SEED_BASE_URL` ✅
Faltan en móvil: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` (tras generar keystore).

## Secrets deploy-hostinger (faltan, para automatizar el deploy)
`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_KEY`, `HOSTINGER_PORT`.

---

## Gotchas críticos (leer antes de tocar nada)

1. **contentVersion**: prod tiene **67**; dev **4-5**. El seed se dispara contra prod (fuente de verdad), nunca al revés.
2. **Borrar DB del celu tras sembrar**: el dispositivo solo re-semilla `assets/piiyaak.db` cuando la DB local falta; si agregás contenido embebido, borrá `files/SQLite/piiyaak.db` y relanzá.
3. **EXPO_PUBLIC_* se hornea en Metro** (no en el build nativo) para dev-client: arrancar `EXPO_PUBLIC_API_URL=... EXPO_PUBLIC_SEED_BASE_URL=... npx expo start`. Sin la var, el gate cae al fallback y no descarga.
4. **npm install con Metro vivo** → cache envenenado (500 "Unable to resolve"). Pausar Metro antes de instalar paquetes; reiniciar con `--clear`.
5. **Los tests del backend corren contra la MISMA DB de dev** (`piiyaak_test`); una corrida completa resetea el `ContentVersion` a 4. Los datos sobreviven (bumps por mutación).
6. **`zod` debe estar en `dependencies`** (no dev): las rutas admin lo importan en runtime; con `NODE_ENV=production` el build falla si está en dev.
7. **`/descargas/piiyaak.apk` ya no existe**: el link correcto es `/descargar` (página con QR + botón desde `apk/latest.json` de R2).
8. **SW no intercepta `.apk`**: bypass añadido en `public/sw.js`.
9. **`android/` es gitignoreado**: la firma release se aplica en CI con `scripts/ci/apply-release-signing.js` (post-prebuild). Ediciones manuales se pierden al regenerar.
10. **`build.gradle` stock ya trae `signingConfigs.release` (referencia) que apunta al debug.keystore**: el script de CI redefine el bloque con las vars de entorno; local cae a debug.
11. **⚠️ BUG del workflow `apk-release.yml` (APKs futuras de CI salen debug-firmadas)**: aunque se configuren los secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` en `Piiyaak-Mobile-`, el workflow **no los inyecta** en el job de build (no define esos env ni ejecuta el decode+`apply-release-signing.js` con las credenciales). Al día 2026-11-11 la APK v1.1 publicada en R2 está debug-firmada (por eso se instala solo tras "fuentes desconocidas" y coexiste con builds locales firmados con `release.keystore`). **Fix pendiente**: en el workflow, decode del secret a `android/keystore/release.keystore` + exportar `KEYSTORE_FILE/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD` antes de `./gradlew assembleRelease` (el script `scripts/ci/apply-release-signing.js` ya soporta las vars). Verificar tras el fix con `apksigner verify --print-certs` (SHA256 esperado del release local: `11757597cbaede64f87c6803f84966d093ef3276db7ae440717697082d2734e4`).

## Flujo de deploy backend (manual, actual)
1. Tarball `piiyaak-nextjs.tar.gz` (desde `origin/main`, sin `.env`/node_modules) → Hostinger.
2. Descomprimir en `~/current`, `.env` intacto (agregar las 6 vars de dispatch).
3. `npm ci && npx prisma generate && npm run build`, reiniciar el servicio Node.
4. Verificar: `https://piiyaak.com/api/sync/version` → JSON con `contentVersion` + `serverTime`; `https://piiyaak.com/descargar` → 200.

## Verificación actual (2026-11-11)
- `https://piiyaak.com/api/sync/version` → ✅ `{"contentVersion":"67","serverTime":"..."}`.
- `https://piiyaak.com/descargar` → ✅ 200 (en build nuevo; si da 404, el deploy viejo está corriendo).
- Simulación local del tarball (extraer + npm ci + build + start) → ✅ los 3 endpoints responden.

## Fixes v1.2 (2026-11-11) — bugs reportados de la APK v1.1

**Reporte del dueño**: (1) imágenes/ilustraciones/portadas no cargan offline; (2) juego Escucha dice "no hay audios" pese a que la DB embebida v67 trae 31 audios.

**Causas confirmadas en código + fixes aplicados** (todo JS-only, sin `expo prebuild --clean`):
1. **Puente bundled faltante**: `CourseCover` (`cursos/index.tsx`) y `CachedLessonImage`/`CachedLessonAudio` (`cursos/leccion/[id].tsx`) resolvían SOLO con `resolveCachedUri` (media-cache → URL remota) → offline en blanco aunque la portada (`fcc700da…jpg`) y el audio de lección (`1794210299397-Kupe.ogg`) están embebidos. **Fix**: bundled primero (`resolveBundledIllustrationUri`/`resolveBundledAudioUri`, ahora exportados), luego cache, remota al final. Clave de cache con URL cruda (parity con `populateMediaCache`).
2. **Escucha frágil**: usaba `listAZ(null,200)` (corte alfabético) + filtro `audioUrl`. Con v67 pasaba (23 de las primeras 200 tienen audio), pero el reporte implicaba DB viva ≠ v67 (datos de instalación previa: el copy de primer arranque hace skip si el archivo existe). **Fix**: query directa `listWithAudio(limit)` nueva en `WordStore` (sqlite + memory) + **defensa de re-seed** en `db-context.tsx`: si la DB viva está vacía (0 words) o ilegible, se reinstala desde el bundle (una DB con datos NUNCA se toca).
3. **Medios del seed aislados en disco**: `seed-swap.ts` movía los medios del zip con nombre `<sha256-contenido>` pero `MediaCache.localUriFor` busca `url_<url-normalizada>` → nadie los resolvía jamás; además `moveFile` podía fallar sin `ensureDir` previo. **Fix**: el swap recibe `mediaUrls` (leídas de la DB nueva: words + portadas publicadas), matching file↔URL por basename, mueve/copía con la clave EXACTA `url_<norm>` (`urlCacheFileName` exportado desde media-cache), `ensureDir` de `audios/`+`illustrations/` y `copyFile` para URLs duplicadas. Sin URL vigente conocida, el archivo conserva su nombre por contenido.
4. **Tests**: `listWithAudio` (store), rework de `seed-swap.test.ts` (fakeDeps con copyFile/ensureDir/copies + 2 tests nuevos + renames), `seed-flow.test.ts` (fakeTempDb con `listMediaUrls` + `copyFile`). Typecheck ✅, 238/238 ✅.

**Build de prueba**: versionCode **2** / versionName **1.2** (`-PversionCode=2 -PversionName=1.2`), firma release local (SHA256 `11757597cbaede64…`). Deploy a R2 recién tras la validación del dueño en dispositivo.
⚠️ **Trap firma local**: `keystore.env` asigna las vars SIN `export` → sourcearlo simple deja al `gradlew` (proceso hijo) sin verlas y el build **sale debug-signed sin error** (`CN=Android Debug`). Usar `set -a && source ~/.piiyaak/keys/keystore.env && set +a` y verificar SIEMPRE con `apksigner verify --print-certs` (tools: `$ANDROID_HOME/build-tools/36.0.0/`).

## Fixes v1.3 (2026-11-11, misma sesión) — Ajustes + variedad de juegos

Validado v1.2 en dispositivo por el dueño ("todo bien") → merge a `origin/main` y sesión de mejoras:
1. **Ajustes**: vista de sincronización rediseñada con kit Fase 2 (Card/ThemedText/Button/Chip + lucide); feedback explícito de éxito/error (el sync fallido era silencioso); palabras locales/versión de contenido siempre visibles; barra de progreso; "Sincronizar datos" renombrado a "Enviar cambios pendientes (N)" y visible solo con outbox > 0.
2. **Juegos app**: `WordStore.listRandom` (muestreo `ORDER BY RANDOM()` desde TODO el diccionario) reemplaza el cap `listAZ(null,50,0)` en flashcards/relacionar/ordena/completar; Escucha con tarjeta de revelado (nasaYuwe + pronunciación + reescuchar), re-baraja al reintentar (`gameKey`) y audio por cache→heredado→bundled→remota (`resolveAudioUri`).
3. **Juegos web**: exclusión de palabras servidas recientemente en `game-words.ts` (ring buffer compartido + `exclude=` + retry sin exclusión si <4); Escucha muestrea 16. Tests: `game-words.test.ts` con 3 casos nuevos de variedad.
4. Pendiente para el dueño: probar v1.3 en dispositivo; modo infinito con vidas queda para más adelante.

## Estructura de scripts (móvil)
- `scripts/generate-bundled-media-map.ts` → `src/bundled-media.generated.ts` (require() de assets/audios + illustrations).
- `scripts/embed-seed-media.ts` → copia `media/<sha>.<ext>` del seed a `assets/audios|images` con nombre original; verifica sha256.
- `scripts/upload-apk-to-r2.ts` → sube archivo a R2 (credenciales por env).
- `scripts/ci/apply-release-signing.js` → parchea `build.gradle` post-prebuild (firma release + versionCode por props).
- `scripts/relate-audios.py`, `relate-illustrations.py`, `export-db.py` → **DEPRECATED** (IDs muertos `cmw6dy*`).

## URLs clave
- Backend prod: `https://piiyaak.com` (API + admin + descargas).
- Dev local: `http://localhost:3000` (Metro 8081, DB docker 3307 `piiyaak_test`).
- R2: bucket `ilustraciones-piiyaal-test`, base `https://pub-cc9e53869548453a91a0d518d085a6c4.r2.dev`.
- Repos: `MalvarezU/DiccionarioNasa`, `MalvarezU/Piiyaak-Mobile-`.
