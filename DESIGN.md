# DESIGN.md — Piiyaak (Fase 1)

Dirección visual: identidad Piiyaak compartida con la web. Color como señal
(verde territorio = acierto, rojo = error), nunca decoración ambiente. Tipografía
Inter (UI) + Source Serif 4 (contenido/headings). Escala de espaciado 4pt.

## Paleta (hex nombrados)

- montana `#173f35` — primario (header verde, acentos ancla)
- montanaDeep `#0e2a22` — hover / anclas profundas
- territorio `#496b55` — secundario, ring de foco, señal de acierto
- amarilloTierra `#d7ae55` — acento amarillo
- terracota `#b96f4a` — subrayado de links, acento cálido
- crema `#f5f0e6` — superficie base cálida (background)
- card `#ffffff` — superficie de tarjeta
- text `#1c1917` — texto principal
- muted `#78716c` — texto secundario
- border `#e7e5e4` — bordes
- success `#496b55` / successSoft `#dcfce7`
- danger `#dc2626` / dangerSoft `#fee2e2`
- primary `#173f35` (= montana, compat)

## Tipografía

- fonts.sans `Inter_400Regular`, sansMedium, sansSemibold
- fonts.serif `SourceSerif4_400Regular`, serifSemibold, serifBold
- type ramp: display, title, heading, word, body, bodyMedium, bodyStrong, label, caption

## Espaciado / radios / sombras

- spacing: xs 4, sm 8, mid 12, md 16, lg 24, xl 32, xxl 48
- radiusScale: sm 8, md 12, lg 16, full 9999
- shadows: card, raised (boxShadow strings, tinte montana)

## Principios

- Un solo elemento memorable por pantalla; el resto quieto y disciplinado.
- Zona táctil mínima 44pt (minHit).
- Motion: fast 150, base 250, max 350ms; curva power3.out.
- Sin hover; pressed feedback 0.92.
- Fuentes de verdad: `src/theme.ts` (tokens) y `src/components/ui/` (kit).