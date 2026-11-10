/**
 * Identidad Piiyaak compartida con la web.
 *
 * Port de piiyaak-deploy/DESIGN.md: paleta territorio (nombres en español,
 * como la web), tipografía Inter/Source Serif 4, escala de espaciado 4pt,
 * radios de las "syntax cards" y contrato de motion de la Fase 2.5.
 *
 * El color es señal (verde territorio = acierto, rojo = error), nunca
 * decoración ambiente. Un único archivo de tokens; pantallas y componentes
 * importan desde acá y jamás escriben hex literales (nudge óptico local se
 * anota con comentario).
 */
export const theme = {
  // — Territorio Piiyaak (nombres de la web) —
  montana: "#173f35", // primario (bg green header, acentos ancla)
  montanaDeep: "#0e2a22", // hover / anclas profundas
  territorio: "#496b55", // secundario, ring de foco, señal de acierto
  amarilloTierra: "#d7ae55", // acento amarillo, confetti
  terracota: "#b96f4a", // subrayado de links, acento cálido
  crema: "#f5f0e6", // superficie base cálida

  // — Superficie y neutros —
  background: "#f5f0e6", // crema de la web (antes #faf7f0 pre-rediseño)
  card: "#ffffff",
  text: "#1c1917",
  muted: "#78716c",
  border: "#e7e5e4",
  onTint: "#ffffff", // texto de contraste sobre superficie teñida, siempre blanco

  // — Señal de incidencia —
  success: "#496b55", // verde territorio = acierto (DESIGN.md)
  successSoft: "#dcfce7", // fondo suave detrás de la señal verde
  danger: "#dc2626", // error (destructive de la web)
  dangerSoft: "#fee2e2", // fondo suave detrás de la señal roja

  // — Compat: nombre pre-rediseño resuelto al valor actual —
  primary: "#173f35", // = montana (las 13 pantallas existentes lo consumen)
  // rounded-xl de las syntax cards de la web
  radius: 12,
} as const;

/** Escala de radios (tokens Tailwind de la web). */
export const radiusScale = {
  sm: 8, // rounded-lg
  md: 12, // rounded-xl
  lg: 16,
  full: 9999, // cápsulas
} as const;

/** Espaciado en grilla de 4pt (nombres por tamaño, no por uso). */
export const spacing = {
  xs: 4,
  sm: 8,
  mid: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Familias tipográficas: Inter para UI, Source Serif 4 para palabras de
 * contenido y headings de juego (regla web). Los nombres deben coincidir
 * 1:1 con las fuentes cargadas en src/app/_layout.tsx (useFonts).
 */
export const fonts = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemibold: "Inter_600SemiBold",
  serif: "SourceSerif4_400Regular",
  serifSemibold: "SourceSerif4_600SemiBold",
  serifBold: "SourceSerif4_700Bold",
} as const;

/**
 * Ramp de estilos nombrados (piso 12px = --text-2xs de la web, nada por
 * debajo). Pantallas usan variantes, no fontSizes crudos (expo-design-system).
 */
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontFamily: fonts.serifBold, color: theme.text },
  title: { fontSize: 22, lineHeight: 28, fontFamily: fonts.serifSemibold, color: theme.text },
  heading: { fontSize: 20, lineHeight: 26, fontFamily: fonts.serifSemibold, color: theme.text },
  word: { fontSize: 28, lineHeight: 34, fontFamily: fonts.serif, color: theme.montana },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.sans, color: theme.text },
  bodyMedium: { fontSize: 16, lineHeight: 24, fontFamily: fonts.sansMedium, color: theme.text },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fonts.sansSemibold, color: theme.text },
  label: { fontSize: 14, lineHeight: 20, fontFamily: fonts.sansMedium, color: theme.text },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.sans, color: theme.muted },
} as const satisfies Record<string, { fontSize: number; lineHeight: number; fontFamily: string; color: string }>;

/** Contrato motion Fase 2.5: una sola curva de proa, pct micro ≤350ms. */
export const motion = {
  fast: 150, // feedback de estado: press, toggle
  base: 250, // transición de elemento: entrada/salida
  max: 350, // tope de micro-interacción (web: cubic-bezier ≤350ms)
  confettiMax: 1000, // excepción documentada del juice kit (750–1000ms)
} as const;
// Curva equivalente a GSAP power3.out:
//   Easing.bezier(0.22, 1, 0.36, 1)
// (sin repartirla como objeto: los tweens la instancian de Reanimated).

/** Elevaciones leves con tinte montana (nunca grises genéricos). */
export const shadows = {
  card: "0 1px 2px rgba(14, 42, 34, 0.08)",
  raised: "0 4px 12px rgba(14, 42, 34, 0.12)",
} as const;

/** Mínimo de zona táctil (web: min-h-11 en todo control de juego). */
export const minHit = 44;
