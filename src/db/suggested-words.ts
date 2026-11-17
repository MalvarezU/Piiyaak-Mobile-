import type { SessionState } from "../api";
import type { WordStore } from "./sqlite-store";
import type { WordRow } from "./types";

/**
 * Hash FNV-1a (32 bits) de un string. Copiado de la ruta web
 * (`src/app/api/dictionary/suggested-words/route.ts`) para paridad
 * determinista entre mobile y web.
 */
export function hashDateKey(dateKey: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const SUGGESTED_DATE_KEY = "suggestedDate";
const SUGGESTED_IDS_KEY = "suggestedIds";

/**
 * Palabras sugeridas del día, calculadas localmente sobre el store
 * sincronizado (sin fetch al servidor). Determinista por hash de fecha.
 *
 * Preferir ilustradas: si hay >=5 publicadas con illustrationUrl NOT NULL,
 * las 5 son ilustradas (ventana con wraparound por hash); si no, se
 * completa con palabras sin ilustración.
 *
 * Caché por fecha en kv: si la fecha cacheada coincide y todos los ids
 * resuelven contra el store, se devuelven sin recalcular.
 *
 * `session` se acepta por compatibilidad de firma pero no se usa (no hay
 * fetch). No registra historial: eso lo hace la ficha al abrirse.
 */
export async function loadSuggestedWords(
  store: WordStore,
  dateISO: string,
  _session?: SessionState | null
): Promise<WordRow[]> {
  // Cache hit.
  const cachedDate = await store.getKV(SUGGESTED_DATE_KEY);
  const cachedIdsRaw = await store.getKV(SUGGESTED_IDS_KEY);
  if (cachedDate === dateISO && cachedIdsRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cachedIdsRaw);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      const ids = parsed as string[];
      const resolved: WordRow[] = [];
      let allResolve = true;
      for (const id of ids) {
        const w = await store.getById(id);
        if (!w) {
          allResolve = false;
          break;
        }
        resolved.push(w);
      }
      if (allResolve) return resolved;
    }
  }

  // Recalcular.
  const all = await store.listAZ(null, 100000, 0);
  const published = all.filter((w) => w.status === "PUBLISHED");
  const illustrated = published
    .filter((w) => !!w.illustrationUrl)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const nonIllustrated = published
    .filter((w) => !w.illustrationUrl)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const chosenIds: string[] = [];
  const chosenSet = new Set<string>();

  const n = illustrated.length;
  if (n >= 5) {
    const offset = hashDateKey(dateISO) % n;
    for (let i = 0; i < 5; i++) {
      const id = illustrated[(offset + i) % n]!.id;
      if (!chosenSet.has(id)) {
        chosenIds.push(id);
        chosenSet.add(id);
      }
    }
  } else {
    for (const x of illustrated) {
      if (!chosenSet.has(x.id)) {
        chosenIds.push(x.id);
        chosenSet.add(x.id);
      }
    }
    const remaining = 5 - chosenIds.length;
    const m = nonIllustrated.length;
    if (remaining > 0 && m > 0) {
      const offset2 = hashDateKey(dateISO + "|fill") % m;
      for (let i = 0; i < remaining; i++) {
        if (chosenIds.length >= 5) break;
        if (i >= m) break;
        const id = nonIllustrated[(offset2 + i) % m]!.id;
        if (!chosenSet.has(id)) {
          chosenIds.push(id);
          chosenSet.add(id);
        }
      }
    }
  }

  // Store vacío → [] (chosenIds vacío).
  const words: WordRow[] = [];
  for (const id of chosenIds) {
    const w = await store.getById(id);
    if (w) words.push(w);
  }

  await store.setKV(SUGGESTED_DATE_KEY, dateISO);
  await store.setKV(SUGGESTED_IDS_KEY, JSON.stringify(chosenIds));

  return words;
}
