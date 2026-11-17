/**
 * Buffer de rotación de palabras vistas en los juegos ("palabras recientes").
 *
 * Comparte la idea de la web (Diccionario nasa): sin memoria de lo ya
 * mostrado, cada ronda repetía palabras constantemente. Acá se persiste en
 * KV un arreglo JSON de ids, más-reciente-primero, compartido por TODOS los
 * juegos. La escritura es best-effort: si el KV falla, se pierde variedad,
 * nunca funcionalidad.
 */
import type { WordStore } from "../db/sqlite-store";

/** Tamaño máximo del buffer de palabras recientes. */
export const RECENT_MAX = 48;

/** Clave KV compartida por todos los juegos del móvil. */
export const RECENT_KEY = "games:recent";

/**
 * Lee los ids recientes. Defensivo: JSON corrupto, un no-arreglo o
 * entradas no-string devuelven lo que se pueda (`[]` en el peor caso);
 * el buffer nunca debe romper un juego.
 */
export async function getRecentWordIds(
  store: Pick<WordStore, "getKV">
): Promise<string[]> {
  try {
    const raw = await store.getKV(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Fusiona `ids` al frente del buffer (más-reciente-primero), sin duplicados
 * (conserva la primera aparición) y con tope en `RECENT_MAX`. Traga errores
 * de almacenamiento: un KV lleno o fallido solo reduce la variedad futura.
 */
export async function trackRecentWordIds(
  store: Pick<WordStore, "getKV" | "setKV">,
  ids: readonly string[]
): Promise<void> {
  try {
    const previous = await getRecentWordIds(store);
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const id of [...ids, ...previous]) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
      if (merged.length >= RECENT_MAX) break;
    }
    await store.setKV(RECENT_KEY, JSON.stringify(merged));
  } catch {
    // Best-effort: sin buffer, los juegos siguen funcionando (variedad menor).
  }
}
