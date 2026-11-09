import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDatabaseSync } from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { SQLiteWordStore, type WordStore, type OutboxRow } from "./db/sqlite-store";
import { SQLiteCourseStore, type CourseStore } from "./db/course-store";
import type { SeedState } from "./db/seed-machine";
import type { WordRow } from "./db/types";
import { syncNow, flushOutbox, type AuthError } from "./db/sync";
import { refreshMediaAfterSync } from "./db/sync-media";
import { defaultMediaCache } from "./db/media-fs";
import { useAuth } from "./auth";
import { apiFetch } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { downloadWordAudio, removeWordAudio } from "./audio";
import { downloadWordIllustration, removeWordIllustration } from "./illustrations";

/**
 * Contrato B2 (§1.2): el provider expone el store de cursos derivado de la
 * MISMA instancia `SQLiteDatabase` que usa `SQLiteWordStore`. Forma admitida:
 * valor adicional `courseStore` en `DbContextValue` (sin provider separado).
 */
export interface CourseStoreHandle {
  courses: CourseStore;
}

interface DbContextValue {
  store: WordStore | null;
  courseStore: CourseStore | null;
  ready: boolean;
  syncing: boolean;
  syncProgress: { done: number; total: number } | null;
  lastSync: string | null;
  sync: () => Promise<void>;
  syncData: () => Promise<void>;
  favorites: string[];
  toggleFavorite: (word: WordRow) => Promise<void>;
  history: WordRow[];
  pushHistory: (word: WordRow) => void;
  pendingOutboxCount: number;
  /** W3 — estado del seed ("Preparando contenido"). `null` = inactivo. */
  seedState: SeedState | null;
  retrySeed: () => Promise<void>;
  continueTextOnly: () => void;
}

const DbContext = createContext<DbContextValue | null>(null);

const FAV_KEY = "piiyaak:favs";

export function DbProvider({ children }: { children: React.ReactNode }) {
  const { session, ready: authReady } = useAuth();
  const [store, setStore] = useState<WordStore | null>(null);
  const [courseStore, setCourseStore] = useState<CourseStore | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [historyWords, setHistoryWords] = useState<WordRow[]>([]);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const storeRef = useRef<WordStore | null>(null);
  // W3 — la orquestación real (descarga/swap) se conecta en W3-06; acá
  // solo el estado que consume la pantalla, con la apertura instantánea
  // existente intacta como fallback.
  const [seedState, setSeedState] = useState<SeedState | null>(null);

  const retrySeed = async (): Promise<void> => {
    setSeedState({ status: "checking" });
  };

  const continueTextOnly = (): void => {
    setSeedState(null);
  };

  // open db once
  useEffect(() => {
    let alive = true;
    (async () => {
      // Primera instalación: si hay una BD pre-poblada en el bundle (assets/piiyaak.db),
      // copiarla antes de abrir, para tener el diccionario offline desde el primer arranque.
      try {
        const asset = Asset.fromModule(require("../assets/piiyaak.db"));
        await asset.downloadAsync();
        if (asset.localUri) {
          const dbDir = `${FileSystem.documentDirectory}SQLite`;
          await FileSystem.makeDirectoryAsync(dbDir, { intermediates: true });
          const dbPath = `${dbDir}/piiyaak.db`;
          const info = await FileSystem.getInfoAsync(dbPath);
          if (!info.exists) {
            await FileSystem.copyAsync({ from: asset.localUri, to: dbPath });
          }
        }
      } catch {
        // Sin asset pre-poblado (Expo Go / dev): se siembra por red.
      }
      const db = openDatabaseSync("piiyaak.db");
      const s = await SQLiteWordStore.open(db);
      // Conexión única (B2): el store de cursos vive sobre la misma instancia
      // SQLiteDatabase, de modo que las transacciones de syncCourses son
      // efectivas y ninguna pantalla abre su propia conexión.
      const cs = await SQLiteCourseStore.open(db);
      if (!alive) return;
      setStore(s);
      setCourseStore(cs);
      storeRef.current = s;
      setLastSync(await s.getLastSync());
      try {
        const favs = await AsyncStorage.getItem(FAV_KEY);
        if (alive && favs) setFavorites(JSON.parse(favs) as string[]);
      } catch {
        // ignore
      }
      // load history
      try {
        const ids = await s.listHistory(50);
        if (alive) setHistoryIds(ids);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // persist favorites to AsyncStorage
  useEffect(() => {
    AsyncStorage.setItem(FAV_KEY, JSON.stringify(favorites)).catch(() => {});
  }, [favorites]);

  // derive history words
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const rows: WordRow[] = [];
      for (const id of historyIds) {
        const w = await store.getById(id);
        if (w) rows.push(w);
      }
      if (alive) setHistoryWords(rows);
    })();
    return () => {
      alive = false;
    };
  }, [store, historyIds.join(",")]);

  // merge server favorites on login
  useEffect(() => {
    if (!authReady || !session || !store) return;
    let alive = true;
    (async () => {
      try {
        const res = await apiFetch("/api/dictionary/favorites", {}, session);
        if (!res.ok) return;
        const body = (await res.json()) as { favorites?: { wordId: string }[] };
        const serverIds = (body.favorites ?? []).map((f) => f.wordId);
        if (!alive) return;
        setFavorites((prev) => {
          const set = new Set(prev);
          for (const id of serverIds) set.add(id);
          return [...set];
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [authReady, session?.user?.id, store]);

  const refreshPending = async () => {
    if (!storeRef.current) return;
    try {
      const p = await storeRef.current.pendingOutbox();
      setPendingOutboxCount(p.length);
    } catch {
      // ignore
    }
  };

  const sync = async () => {
    if (!store || syncing) return;
    setSyncing(true);
    setSyncProgress(null);
    try {
      await syncNow(store, session, (done, total) => setSyncProgress({ done, total }));
      // B3-04: poblado + poda solo tras sync exitosa (si `syncNow` lanza,
      // no se llega acá: nunca tras sync fallida). Best-effort: un fallo
      // de medios no revierte el sync; las favoritas nunca se podan.
      try {
        await refreshMediaAfterSync(store, defaultMediaCache(), { favorites });
      } catch {
        // best-effort: el diccionario ya sincronizó
      }
      if (session) await flushOutbox(store, session).catch(() => {});
      setLastSync(await store.getLastSync());
      await refreshPending();
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const syncData = async () => {
    if (!store) return;
    setSyncing(true);
    try {
      if (session) await flushOutbox(store, session).catch(() => {});
      await refreshPending();
    } finally {
      setSyncing(false);
    }
  };

  const toggleFavorite = async (word: WordRow) => {
    const isFav = favorites.includes(word.id);
    const next = isFav
      ? favorites.filter((id) => id !== word.id)
      : [...favorites, word.id];
    setFavorites(next);
    // Descargas en background al favoritar / borrado al desfavoritar (RF-47).
    // Hash-aware (B3-03): resuelven por contenido con fallback heredado.
    if (!isFav) {
      if (word.audioUrl) {
        downloadWordAudio({
          id: word.id,
          audioUrl: word.audioUrl,
          audioSha256: word.audioSha256,
        }).catch(() => {});
      }
      if (word.illustrationUrl) {
        downloadWordIllustration({
          id: word.id,
          illustrationUrl: word.illustrationUrl,
          illustrationSha256: word.illustrationSha256,
        }).catch(() => {});
      }
    } else {
      if (word.audioUrl) {
        removeWordAudio({
          id: word.id,
          audioUrl: word.audioUrl,
          audioSha256: word.audioSha256,
        }).catch(() => {});
      }
      if (word.illustrationUrl) {
        removeWordIllustration({
          id: word.id,
          illustrationUrl: word.illustrationUrl,
          illustrationSha256: word.illustrationSha256,
        }).catch(() => {});
      }
    }
    if (store) {
      const op = isFav ? "favorite.remove" : "favorite.add";
      await store.addOutbox("favorite", op, JSON.stringify({ wordId: word.id }));
      await refreshPending();
      // best-effort push
      if (session) {
        try {
          await apiFetch(
            "/api/dictionary/favorites",
            { method: "POST", body: JSON.stringify({ wordId: word.id }) },
            session
          );
          // server toggles; if our desired state differs, push again? server toggle is idempotent-ish;
          // we rely on outbox merge later. Mark synced.
          const pending = await store.pendingOutbox();
          const last = pending[pending.length - 1];
          if (last) await store.markOutboxSynced(last.id);
        } catch {
          // queued
        }
        await refreshPending();
      }
    }
  };

  const pushHistory = (word: WordRow) => {
    if (store) {
      store.addHistory(word.id, new Date().toISOString()).catch(() => {});
      if (session) {
        apiFetch("/api/dictionary/history", { method: "POST", body: JSON.stringify({ wordId: word.id }) }, session).catch(() => {});
      } else {
        store.addOutbox("history", "history.view", JSON.stringify({ wordId: word.id })).then(refreshPending).catch(() => {});
      }
    }
    setHistoryIds((prev) => [word.id, ...prev.filter((x) => x !== word.id)].slice(0, 50));
  };

  // flush on foreground
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      if (state === "active" && session && store) {
        flushOutbox(store, session).then(refreshPending).catch(() => {});
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [session, store]);

  // flush on session change
  useEffect(() => {
    if (session && store) {
      flushOutbox(store, session).then(refreshPending).catch(() => {});
    }
  }, [session?.user?.id, store]);

  const value = useMemo(
    () => ({
      store,
      courseStore,
      ready: !!store,
      syncing,
      syncProgress,
      lastSync,
      sync,
      syncData,
      favorites,
      toggleFavorite,
      history: historyWords,
      pushHistory,
      pendingOutboxCount,
      seedState,
      retrySeed,
      continueTextOnly,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, courseStore, syncing, syncProgress, lastSync, favorites, historyWords, pendingOutboxCount, seedState]
  );
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb fuera de DbProvider");
  return ctx;
}
