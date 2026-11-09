import { apiFetch, type SessionState } from "../api";
import type { WordStore, OutboxRow } from "./sqlite-store";
import type { SyncResult, WordRow } from "./types";
import {
  getLocalVersion,
  getRemoteVersion,
  setLocalVersion,
  compareVersions,
} from "./version-gate";
import {
  collapseOutboxForDrain,
  favoriteWordId,
} from "./outbox";

export {
  OUTBOX_MAX_PENDING,
  OUTBOX_PAYLOAD_MAX_BYTES,
  OutboxLimitError,
} from "./outbox";

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

/**
 * Primera vez: seed; después: deltas. Gate solo-adelante (W3 §4.6, F0 §1.3):
 * - `skip` (igualdad exacta) → sin red adicional, retorno vacío.
 * - `noop` (remota < local, D3) → sin seed ni escrituras, warn
 *   estructurado, la app sigue con local. Causas típicas: fila
 *   `ContentVersion(id=1)` recreada, restore de BD (runbook R12).
 * - `seed` (remota > local o local ausente/inválido) → con `runSeed`
 *   inyectado delega el flujo §4.2–§4.5; sin inyección conserva la rama
 *   heredada (seed o incremental con `since` + adopción conjunta).
 * - Versión inalcanzable (offline) con bundle → resuelve local sin lanzar.
 * Acepta `session = null`: la lectura nunca exige autenticación.
 */
export async function syncNow(
  store: WordStore,
  session: SessionState | null,
  onProgress?: (done: number, total: number) => void,
  opts?: {
    runSeed?: (
      remote: string,
      serverTime: string,
      onProgress?: (done: number, total: number) => void
    ) => Promise<void>;
  }
): Promise<SyncResult> {
  const local = await getLocalVersion(store);
  const hasData = (await store.count()) > 0;
  let remote: { contentVersion: string; serverTime: string };
  try {
    remote = await getRemoteVersion(session);
  } catch (e) {
    if (hasData && local.lastSync) {
      return { applied: 0, removed: 0, serverTime: local.lastSync, hasMore: false };
    }
    throw e;
  }
  const move = compareVersions(local.contentVersion, remote.contentVersion);
  if (move.action === "skip") {
    return { applied: 0, removed: 0, serverTime: remote.serverTime, hasMore: false };
  }
  if (move.action === "noop") {
    console.warn(
      `[sync] noop sin downgrade (D3): remote ${remote.contentVersion} < local ${local.contentVersion} — se mantiene local (${move.reason})`
    );
    return {
      applied: 0,
      removed: 0,
      serverTime: local.lastSync ?? remote.serverTime,
      hasMore: false,
    };
  }
  if (opts?.runSeed) {
    await opts.runSeed(move.remote, remote.serverTime, onProgress);
    return { applied: 0, removed: 0, serverTime: remote.serverTime, hasMore: false };
  }
  const res =
    !hasData || !local.lastSync
      ? await fullSeed(store, session, onProgress)
      : await incrementalSync(store, session, onProgress);
  await setLocalVersion(store, {
    contentVersion: remote.contentVersion,
    serverTime: res.serverTime ?? remote.serverTime,
  });
  return res;
}

/** Drena el outbox a la plataforma (favoritas + historial). */
export async function flushOutbox(
  store: WordStore,
  session: SessionState | null
): Promise<void> {
  if (!session) return;
  // FIFO (pendingOutbox ordena por id ascendente) con colapso por clave:
  // las favoritas intermedias del mismo wordId se subsumen en la última
  // (spec §4.3); historial y progreso van íntegros.
  const pending: OutboxRow[] = await store.pendingOutbox();
  const { toSend, subsumedIds } = collapseOutboxForDrain(pending);
  const subsumed = new Set(subsumedIds);
  for (const row of toSend) {
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
      if (ok) {
        await store.markOutboxSynced(row.id);
        // Convergencia: las intermedias subsumidas del mismo wordId quedan
        // confirmadas por el `ok` de la superviviente (su efecto está
        // incluido en la última operación enviada).
        if (row.entity === "favorite") {
          const wordId = favoriteWordId(row);
          if (wordId !== null) {
            for (const other of pending) {
              if (
                subsumed.has(other.id) &&
                favoriteWordId(other) === wordId
              ) {
                await store.markOutboxSynced(other.id);
              }
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
      // leave pending for next attempt
    }
  }
}
