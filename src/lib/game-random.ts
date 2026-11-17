/**
 * Utilidades aleatorias compartidas por los juegos (puerto móvil).
 *
 * Espejo exacto de `Diccionario nasa /src/lib/game-utils.ts`: ambas
 * plataformas deben barajar con el mismo Fisher-Yates para que el
 * comportamiento sea comparable. Ninguna función muta el arreglo de
 * entrada: trabajan sobre una copia.
 */

/** Devuelve una copia barajada de `items` (la entrada queda intacta). */
export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Devuelve hasta `count` elementos aleatorios de `items` (entrada intacta).
 * `count <= 0` produce `[]`; `count > length` produce el arreglo completo
 * barajado.
 */
export function sampleRandom<T>(items: readonly T[], count: number): T[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  return shuffle(items).slice(0, Math.min(Math.floor(count), items.length));
}
