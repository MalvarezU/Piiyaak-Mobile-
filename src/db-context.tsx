import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { openDatabaseSync } from "expo-sqlite";
import { SQLiteWordStore, type WordStore } from "./db/sqlite-store";
import type { WordRow } from "./db/types";
import { syncNow } from "./db/sync";
import { useAuth } from "./auth";

interface DbContextValue {
  store: WordStore | null;
  ready: boolean;
  syncing: boolean;
  lastSync: string | null;
  sync: () => Promise<void>;
  favorites: string[];
  toggleFavorite: (word: WordRow) => Promise<void>;
  history: WordRow[];
  pushHistory: (word: WordRow) => void;
}

const DbContext = createContext<DbContextValue | null>(null);

const FAV_KEY = "piiyaak:favs";

export function DbProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [store, setStore] = useState<WordStore | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<WordRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const db = openDatabaseSync("piiyaak.db");
      const s = await SQLiteWordStore.open(db);
      if (!alive) return;
      setStore(s);
      setLastSync(await s.getLastSync());
      try {
        const { default: AsyncStorage } = await import(
          "@react-native-async-storage/async-storage"
        );
        const favs = await AsyncStorage.getItem(FAV_KEY);
        if (alive && favs) setFavorites(JSON.parse(favs) as string[]);
      } catch {
        // sin persistencia de favs
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const sync = async () => {
    if (!store || syncing) return;
    setSyncing(true);
    try {
      await syncNow(store, session);
      setLastSync(await store.getLastSync());
    } finally {
      setSyncing(false);
    }
  };

  const toggleFavorite = async (word: WordRow) => {
    const next = favorites.includes(word.id)
      ? favorites.filter((id) => id !== word.id)
      : [...favorites, word.id];
    setFavorites(next);
    try {
      const { default: AsyncStorage } = await import(
        "@react-native-async-storage/async-storage"
      );
      await AsyncStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
      // best-effort
    }
  };

  const pushHistory = (word: WordRow) => {
    setHistory((prev) => [word, ...prev.filter((w) => w.id !== word.id)].slice(0, 50));
  };

  const value = useMemo(
    () => ({ store, ready: !!store, syncing, lastSync, sync, favorites, toggleFavorite, history, pushHistory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, syncing, lastSync, favorites, history, session]
  );
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb fuera de DbProvider");
  return ctx;
}
