import { apiFetch, type SessionState } from "../api";
import type { WordStore, OutboxRow } from "./sqlite-store";
import type { SyncResult, WordRow } from "./types";

export class AuthError extends Error {
  constructor(message = "auth required") {
    super(message);
    this.name = "AuthError";
  }
}

const SEED_PAGE_KEY = "seedPage";
const SEED_APPLIED_KEY = "seedApplied";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url: string, init: RequestInit, session: SessionState | null): Promise<Response> {
  const delays = [2000, 8000];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await apiFetch(url, init, session);
      if (res.status === 401) throw new AuthError();
      if (!res.ok) {
        if (attempt < delays.length) {
          await sleep(delays[attempt]!);
          continue;
        }
        throw new Error(`request ${res.status}`);
      }
      return res;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      lastErr = e;
      if (attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("request failed");
}

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
  const storedPage = await store.getKV(SEED_PAGE_KEY);
  const storedApplied = await store.getKV(SEED_APPLIED_KEY);
  let page = 1;
  let applied = 0;
  if (storedPage) {
    const p = parseInt(storedPage, 10) || 0;
    if (p > 0) page = p + 1;
  }
  if (storedApplied) {
    applied = parseInt(storedApplied, 10) || 0;
  }
  let serverTime: string | null = null;
  // We need total; fetch first page to know totalPages. Loop.
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
    await store.setKV(SEED_PAGE_KEY, String(page));
    await store.setKV(SEED_APPLIED_KEY, String(applied));
    if (page >= body.totalPages || body.words.length === 0) break;
    page++;
  }
  await store.setKV(SEED_PAGE_KEY, "0");
  await store.setKV(SEED_APPLIED_KEY, "0");
  if (serverTime) await store.setLastSync(serverTime);
  return { applied, removed: 0, serverTime, hasMore: false };
}

export async function incrementalSync(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void
): Promise<SyncResult> {
  const since = (await store.getLastSync()) ?? new Date(0).toISOString();
  let cursor: string | null = null;
  let applied = 0;
  let removed = 0;
  let serverTime: string | null = null;

  for (;;) {
    const params = new URLSearchParams({ since, limit: "500" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetchWithRetry(`/api/sync?${params}`, {}, session);
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
    onProgress?.(applied, applied);
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
  return incrementalSync(store, session, onProgress);
}

/** Drena el outbox a la plataforma (favoritas + historial). */
export async function flushOutbox(
  store: WordStore,
  session: SessionState | null
): Promise<void> {
  if (!session) return;
  const pending: OutboxRow[] = await store.pendingOutbox();
  for (const row of pending) {
    try {
      let ok = false;
      if (row.entity === "favorite") {
        const res = await apiFetch(
          "/api/dictionary/favorites",
          { method: "POST", body: JSON.stringify(JSON.parse(row.payload)) },
          session
        );
        ok = res.ok;
      } else if (row.entity === "history") {
        const res = await apiFetch(
          "/api/dictionary/history",
          { method: "POST", body: JSON.stringify(JSON.parse(row.payload)) },
          session
        );
        ok = res.ok;
      } else {
        ok = true;
      }
      if (ok) await store.markOutboxSynced(row.id);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // leave pending for next attempt
    }
  }
}
