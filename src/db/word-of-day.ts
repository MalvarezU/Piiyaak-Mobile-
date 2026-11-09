import { apiFetch, type SessionState } from "../api";
import type { WordStore } from "./sqlite-store";
import type { WordRow } from "./types";

export interface WordOfDayResult {
  wordId: string;
}

/**
 * Palabra del día sin exigir sesión: con `null` se omite el encabezado
 * de autenticación. Nunca escribe historial; eso lo decide el llamador
 * (con sesión lo registra ficha vía `pushHistory`; sin sesión, solo
 * historial local + outbox). Retorna `null` si no hay palabra o falla.
 */
export async function fetchWordOfDay(
  dateISO: string, // "YYYY-MM-DD"
  session: SessionState | null
): Promise<WordOfDayResult | null> {
  const res = await apiFetch(
    `/api/dictionary/word-of-day?date=${encodeURIComponent(dateISO)}`,
    {},
    session
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { word?: { id?: unknown } | null };
  const id = body.word?.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return { wordId: id };
}

/** Vista anónima: historial local + outbox, nunca servidor. */
export async function recordWordOfDayLocalView(
  store: WordStore,
  wordId: string
): Promise<void> {
  await store.addHistory(wordId, new Date().toISOString());
  await store.addOutbox("history", "history.view", JSON.stringify({ wordId }));
}

/**
 * Flujo completo de la palabra del día (extraído de `src/app/index.tsx`):
 * caché por fecha en kv → fetch anónimo tolerante → actualiza caché →
 * resuelve contra el store local. Offline con caché vigente devuelve
 * la cacheada; sin caché ni red retorna `null`.
 */
export async function loadWordOfDay(
  store: WordStore,
  dateISO: string,
  session: SessionState | null
): Promise<WordRow | null> {
  const cachedDate = await store.getKV("wodDate");
  const cachedId = await store.getKV("wodId");
  if (cachedDate === dateISO && cachedId) {
    const cached = await store.getById(cachedId);
    if (cached) return cached;
  }
  let remote: WordOfDayResult | null = null;
  try {
    remote = await fetchWordOfDay(dateISO, session);
  } catch {
    return cachedId ? store.getById(cachedId) : null;
  }
  if (!remote) return cachedId ? store.getById(cachedId) : null;
  await store.setKV("wodDate", dateISO);
  await store.setKV("wodId", remote.wordId);
  const w = await store.getById(remote.wordId);
  if (w && !session) await recordWordOfDayLocalView(store, w.id);
  return w;
}
