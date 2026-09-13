import { apiFetch, type SessionState } from "../api";
import type { WordStore } from "./sqlite-store";
import type { SyncResult, WordRow } from "./types";

/**
 * Sincronización contra /api/sync (B3.1):
 * - Sin lastSync: snapshot paginado de /api/sync/seed.
 * - Con lastSync: deltas por cursor hasta agotar.
 */
export async function fullSeed(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  let page = 1;
  let applied = 0;
  let serverTime: string | null = null;
  for (;;) {
    const res = await apiFetch(`/api/sync/seed?page=${page}&pageSize=200`, {}, session);
    if (!res.ok) throw new Error(`seed ${res.status}`);
    const body = (await res.json()) as {
      words: WordRow[];
      total: number;
      totalPages: number;
      serverTime: string;
    };
    await store.upsertWords(body.words);
    applied += body.words.length;
    serverTime = body.serverTime;
    onProgress?.(applied, body.total);
    if (page >= body.totalPages || body.words.length === 0) break;
    page++;
  }
  if (serverTime) await store.setLastSync(serverTime);
  return { applied, removed: 0, serverTime, hasMore: false };
}

export async function incrementalSync(
  store: WordStore,
  session: SessionState | null
): Promise<SyncResult> {
  const since = (await store.getLastSync()) ?? new Date(0).toISOString();
  let cursor: string | null = null;
  let applied = 0;
  let removed = 0;
  let serverTime: string | null = null;

  for (;;) {
    const params = new URLSearchParams({ since, limit: "500" });
    if (cursor) params.set("cursor", cursor);
    const res = await apiFetch(`/api/sync?${params}`, {}, session);
    if (!res.ok) throw new Error(`sync ${res.status}`);
    const body = (await res.json()) as {
      words: WordRow[];
      removedIds: string[];
      serverTime: string;
      nextCursor: string | null;
    };
    await store.upsertWords(body.words);
    await store.removeWords(body.removedIds);
    applied += body.words.length;
    removed += body.removedIds.length;
    serverTime = body.serverTime;
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  if (serverTime) await store.setLastSync(serverTime);
  return { applied, removed, serverTime, hasMore: false };
}

/** Primera vez: seed; después: deltas. */
export async function syncNow(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const hasData = (await store.count()) > 0;
  const lastSync = await store.getLastSync();
  if (!hasData || !lastSync) return fullSeed(store, session, onProgress);
  return incrementalSync(store, session);
}
