# Archive report — `apk-offline-fase-b-app`

- **Change ID:** `apk-offline-fase-b-app`
- **Rama:** `feat/mobile-offline-fase-b`
- **Fecha de cierre:** 2026-11-09
- **Estrategia de entrega:** `single-pr` con `size:exception` aprobada
- **Estado final:** COMPLETO — listo para abrir PR (sin push ni PRs desde esta rama; los abre el orchestrator/usuario)

## Resumen ejecutivo (5 líneas)

1. Los cuatro slices B1–B4 están implementados y verificados de forma independiente, con re-verificación final en verde tras las remediaciones.
2. La verificación final independiente da PASS con 2 WARNINGS no bloqueantes y limitaciones de entorno declaradas.
3. Todos los slices excedieron el presupuesto de 400 líneas con reset de maintainer registrado; la `size:exception` para el single PR está aprobada.
4. Queda un mini-change backend F1-a sin merge (commit `b2b7f94` en repo web, rama `feat/f1a-sha256-sync`); la ruta hash usa fallback URL hasta integrarlo.
5. Paso siguiente recomendado: abrir el PR único contra la base real y adjuntar este informe más el verify-report.

## Verificación final (prevalece sobre snapshots intermedios)

| Gate | Comando / evidencia | Resultado |
|------|---------------------|-----------|
| Tests | `npx vitest run` | 17 archivos / 130 tests PASS |
| Tipos | `npx tsc --noEmit` | exit 0 |
| Linter | N/A — sin config ni script de lint en el repo | N/A justificado |

## Slices entregados

| Slice | Contenido | Commits | Líneas aprox. | Estado |
|-------|-----------|---------|---------------|--------|
| B1 | Gate de versión + seed + sync `null` + word-of-day anónimo | 5 (`3977869`, `7a6c00f`, `d9a475e`, `e34f237`, `7ccb1da`) | ~770 | Reset aprobado |
| B2 | `syncCourses` atómico + conexión SQLite única | 3 + 1 chore `@deprecated` (`fe0ee77`, `b3770ff`, `9f1821d`, `54596a2`) | ~767 | Verificador independiente PASS, reset aprobado |
| B3 | Media-cache por contenido + manifiesto + poda | 3 + 1 remediación de cableado (`b781e73`, `5efec83`, `57cbb22`, `92d4c12`) | Presupuesto excedido | Reset aprobado |
| B4 | Outbox con límites + `AudioPlayer` desacoplado + matriz de cierre | 3 (`40f2731`, `ef5f46e`, `bec149f`) | ~683 | Reset aprobado |

## Mini-change backend F1-a (repo web, fuera de esta rama)

- **Rama:** `feat/f1a-sha256-sync` — **commit:** `b2b7f94`
- **Contenido:** `audioSha256` / `illustrationSha256` en sync/seed
- **Verificación:** 7/7 + fase-a 100/100
- **Pendiente:** integrarlo (merge) para que la ruta hash deje de usar fallback URL (WARNING W1)

## Verify final: PASS + 2 WARNINGS no bloqueantes

| ID | Descripción | Acción de follow-up |
|----|-------------|---------------------|
| W1 | Backend F1-a sin merge; ruta hash usa fallback URL | Mergear `feat/f1a-sha256-sync` en repo web |
| W2 | Verify post-descarga inactivo por defecto | Activarlo/validarlo tras merge de F1-a |

**Limitaciones declaradas del verify:** sin dispositivo físico, sin `expo-sqlite`/FS/AV reales, sin red real.

## Budgets

- Todos los slices con reset de maintainer registrado.
- `size:exception` aprobada para el single PR (el total supera estructuralmente las 400 líneas; dividirlo rompería la atomicidad B2 y el manifiesto B3 verificados en conjunto).

## Estado git al cierre

- Rama `feat/mobile-offline-fase-b`: 16 commits propios sobre la base (`3977869`…`bec149f`), más historial previo (`6fee8ba`, `b7acd1d`, `559c0c2`, `0ae95ee`).
- `git status`: solo `openspec/` sin seguimiento antes de este commit de cierre; resto del árbol limpio.
- Este commit de cierre agrega `openspec/changes/apk-offline-fase-b-app/` completo: `proposal.md`, `spec.md`, `tasks.md`, `verify-report.md`, `archive-report.md` (este archivo).
- Sin push ni PRs desde esta sesión.

## Checklist de cierre

- [x] Re-verify final en verde (130 tests, tsc exit 0)
- [x] Verify-report independiente PASS archivado
- [x] Resets de maintainer registrados por slice
- [x] `size:exception` aprobada para single PR
- [x] `openspec/changes/apk-offline-fase-b-app/` completo commiteado
- [ ] Abrir PR único (lo hace el orchestrator/usuario)
- [ ] Mergear backend F1-a (W1) y activar verify post-descarga (W2)

## Paso siguiente

Abrir el PR único de `feat/mobile-offline-fase-b` contra la base real, adjuntando `verify-report.md` y este `archive-report.md` como evidencia de revisión.
