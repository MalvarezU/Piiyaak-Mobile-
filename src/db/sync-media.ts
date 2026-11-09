import type { SessionState } from "../api";
import { syncNow } from "./sync";
import {
  populateMediaCache,
  manifestKey,
  type MediaCache,
  type MediaRef,
} from "./media-cache";
import type { WordStore } from "./sqlite-store";
import type { SyncResult, WordRow } from "./types";

export interface RefreshMediaOptions {
  /** Ids de favoritas: nunca se podan (spec §6.4). */
  favorites?: readonly string[];
  /** Refs extra fuera de palabras (palabra del día, bloques, portadas). */
  extra?: readonly MediaRef[];
  /** Tamaño de página al recorrer el diccionario (default 500). */
  pageSize?: number;
}

export interface RefreshMediaResult {
  rows: Awaited<ReturnType<MediaCache["buildManifest"]>>;
  ok: string[];
  failed: MediaRef[];
  skipped: number;
  pruned: { removed: number };
}

/**
 * Poblado + poda tras sincronización exitosa (B3-04, spec §1.3):
 * manifiesto desde las palabras vigentes + descarga acotada +
 * persistencia, luego poda lógica (`clearManifestStale`) y física
 * (`prune`) contra el manifiesto persistido. Las favoritas se conservan
 * en ambas capas. El llamador solo la invoca si `syncNow` no lanzó —
 * nunca tras sync fallida.
 */
export async function refreshMediaAfterSync(
  store: WordStore,
  cache: MediaCache,
  opts: RefreshMediaOptions = {}
): Promise<RefreshMediaResult> {
  const pageSize = opts.pageSize ?? 500;
  const extra = opts.extra ?? [];
  const favorites = opts.favorites ?? [];
  const words: WordRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await store.listAZ(null, pageSize, offset);
    words.push(...page);
    if (page.length < pageSize) break;
  }
  const { rows, ok, failed, skipped } = await populateMediaCache(
    cache,
    store,
    words,
    extra
  );
  const validKeys = rows.map((r) => manifestKey(r.wordId, r.kind));
  await store.clearManifestStale(validKeys, favorites);
  const persisted = await store.listManifest();
  const pruned = await cache.prune(persisted, favorites);
  return { rows, ok, failed, skipped, pruned };
}

/**
 * `syncNow` + (solo si tuvo éxito) `refreshMediaAfterSync`. Si el sync
 * lanza, la promesa rechaza sin haber tocado medios: ni poblado ni poda.
 * Un fallo de medios sí propaga (el llamador de UI lo trata best-effort
 * para no revertir un sync exitoso).
 */
export async function syncNowAndRefreshMedia(
  store: WordStore,
  session: SessionState | null,
  cache: MediaCache,
  opts: RefreshMediaOptions & {
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<{ sync: SyncResult; media: RefreshMediaResult }> {
  const { onProgress, ...mediaOpts } = opts;
  const sync = await syncNow(store, session, onProgress);
  const media = await refreshMediaAfterSync(store, cache, mediaOpts);
  return { sync, media };
}
