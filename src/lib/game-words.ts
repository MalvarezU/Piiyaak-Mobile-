/**
 * Trae el pool de palabras para una ronda de juego con rotación.
 *
 * Antes cada ronda hacía `listRandom(50)` sin memoria de lo ya visto: las
 * palabras se repetían constantemente. Acá se leen las recientes
 * (`games:recent`) y se aplican como exclusión con una escalera adaptativa
 * (2×count → count → 0): el pool de Escucha (palabras con audio) es chico,
 * y excluir TODO el buffer siempre caería en exclusión cero, peor que hoy.
 * La escalera degrada con gracia en vez de vaciar el pool.
 */
import type { WordRow } from "../db/types";
import type { WordStore } from "../db/sqlite-store";
import { getRecentWordIds, trackRecentWordIds } from "./game-recent";

export interface GameWordsOptions {
  count: number;
  /** `true` restringe el pool a palabras con audio publicado (Escucha). */
  withAudio?: boolean;
}

/** Mínimo de filas para considerar útil un intento. */
const MIN_POOL = 4;
/** Tope de lectura por intento: suficiente para 12 pedidas + distractores. */
const MAX_FETCH = 64;

/**
 * Devuelve un pool aleatorio evitando (en lo posible) las palabras
 * recientes. El primer intento con al menos `MIN_POOL` filas gana; su
 * resultado queda registrado en el buffer de rotación. Si todos los
 * intentos fallan devuelve `[]` (el caller conserva su estado vacío).
 */
export async function pickGameWords(
  store: WordStore,
  opts: GameWordsOptions
): Promise<WordRow[]> {
  const count = Math.max(0, Math.floor(opts.count));
  if (count === 0) return [];
  const fetchLimit = Math.min(MAX_FETCH, Math.max(count * 2, count + 8));
  const recent = await getRecentWordIds(store);

  // Escalera descendente y sin repetidos: 2×count → count → 0.
  const exclusionSizes = [
    Math.min(recent.length, count * 2),
    Math.min(recent.length, count),
    0,
  ];
  const ladder = [...new Set(exclusionSizes)];

  for (const n of ladder) {
    const exclude = recent.slice(0, n);
    const result = opts.withAudio
      ? await store.listWithAudio(fetchLimit, exclude)
      : await store.listRandom(fetchLimit, exclude);
    if (result.length >= MIN_POOL) {
      // La rotación vive acá: las pantallas nunca tocan el buffer.
      await trackRecentWordIds(
        store,
        result.map((w) => w.id)
      );
      return result;
    }
  }
  return [];
}
