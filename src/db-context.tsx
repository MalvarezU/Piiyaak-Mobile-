import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDatabaseSync } from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { SQLiteWordStore, type WordStore, type OutboxRow } from "./db/sqlite-store";
import type { WordRow } from "./db/types";
import { syncNow, flushOutbox, type AuthError } from "./db/sync";
import { useAuth } from "./auth";
import { apiFetch } from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { downloadAudio, removeAudio } from "./audio";
import { downloadIllustration, removeIllustration } from "./illustrations";

interface DbContextValue {
  store: WordStore | null;
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
}

const DbContext = createContext<DbContextValue | null>(null);

const FAV_KEY = "piiyaak:favs";

export function DbProvider({ children }: { children: React.ReactNode }) {
  const { session, ready: authReady } = useAuth();
  const [store, setStore] = useState<WordStore | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [historyWords, setHistoryWords] = useState<WordRow[]>([]);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const storeRef = useRef<WordStore | null>(null);

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
      if (!alive) return;
      setStore(s);
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
    if (!isFav) {
      if (word.audioUrl) {
        downloadAudio(word.id, word.audioUrl).catch(() => {});
      }
      if (word.illustrationUrl) {
        downloadIllustration(word.id, word.illustrationUrl).catch(() => {});
      }
    } else {
      if (word.audioUrl) {
        removeAudio(word.id, word.audioUrl).catch(() => {});
      }
      if (word.illustrationUrl) {
        removeIllustration(word.id, word.illustrationUrl).catch(() => {});
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, syncing, syncProgress, lastSync, favorites, historyWords, pendingOutboxCount]
  );
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb fuera de DbProvider");
  return ctx;
}
