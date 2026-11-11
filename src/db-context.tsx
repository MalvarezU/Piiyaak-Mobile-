import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { SQLiteWordStore, type WordStore, type OutboxRow } from "./db/sqlite-store";
import { SQLiteCourseStore, type CourseStore } from "./db/course-store";
import { seedReducer, type SeedEvent, type SeedState } from "./db/seed-machine";
import { seedBaseUrl } from "./db/seed-download";
import { runExpoSeedFlow, seedErrorCopy } from "./db/seed-expo";
import {
  getLocalVersion,
  getRemoteVersion,
  setLocalVersion,
  compareVersions,
} from "./db/version-gate";
import {
  initialUpdateNoticeState,
  decideNotice,
  dismissNotice as dismissNoticeState,
  acceptNotice as acceptNoticeState,
  settleNotice,
  metadataOrNull,
  fetchLatestJson,
  readDismissedVersion,
  writeDismissedVersion,
  clearDismissedVersion,
  type UpdateAvailable,
  type UpdateNoticeState,
} from "./db/update-notice";
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
  /** W2 — aviso de contenido nuevo (spec §W2.1). `null` = sin aviso visible. */
  updateAvailable: UpdateAvailable | null;
  dismissUpdate: () => void;
  acceptUpdate: () => Promise<void>;
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
  const courseStoreRef = useRef<CourseStore | null>(null);
  const dbRef = useRef<SQLiteDatabase | null>(null);
  // W3 — estado del seed ("Preparando contenido"). La apertura instantánea
  // existente queda intacta como fallback; el chequeo del seed corre en
  // segundo plano una vez abierto el store (efecto más abajo).
  const [seedState, setSeedState] = useState<SeedState | null>(null);
  // W2 — aviso de contenido nuevo: ante `remote > local` el provider
  // expone el aviso y espera la decisión del usuario (sin descarga
  // inmediata). El `SeedState` vigente toma el control visual al aceptar.
  const [notice, setNotice] = useState<UpdateNoticeState>(initialUpdateNoticeState);
  const seedRequestRef = useRef<{ baseUrl: string; remote: string; serverTime: string } | null>(
    null
  );
  const seedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (seedTimerRef.current) clearTimeout(seedTimerRef.current);
    },
    []
  );

  const reopenStores = async (): Promise<WordStore> => {
    try {
      await dbRef.current?.closeAsync();
    } catch {
      // La conexión puede estar ya cerrada (swap a mitad de camino).
    }
    const db = openDatabaseSync("piiyaak.db");
    dbRef.current = db;
    const s = await SQLiteWordStore.open(db);
    const cs = await SQLiteCourseStore.open(db);
    storeRef.current = s;
    courseStoreRef.current = cs;
    setStore(s);
    setCourseStore(cs);
    setLastSync(await s.getLastSync());
    return s;
  };

  /** Ejecuta el flujo §4.2–§4.5; el fallo se muestra, nunca se propaga. */
  const runSeedInternal = async (baseUrl: string, remote: string, serverTime: string): Promise<void> => {
    const documentDir = FileSystem.documentDirectory;
    if (!documentDir) {
      setSeedState(null);
      return;
    }
    setSeedState({ status: "checking" });
    const emit = (event: SeedEvent): void =>
      setSeedState((prev) => (prev ? seedReducer(prev, event) : prev));
    try {
      await runExpoSeedFlow(
        {
          liveDbPath: `${documentDir}SQLite/piiyaak.db`,
          getStore: () => storeRef.current,
          closeLiveDb: async () => {
            try {
              await dbRef.current?.closeAsync();
            } catch {
              // Ya cerrada: el swap continúa.
            }
            dbRef.current = null;
          },
          reopenLiveDb: () => reopenStores(),
          adoptVersion: async (v, t) => {
            const current = storeRef.current;
            if (!current) throw new Error("sin store tras reapertura");
            await setLocalVersion(current, { contentVersion: v, serverTime: t });
          },
        },
        documentDir,
        { baseUrl, remote, serverTime, emit }
      );
      // `ready` = transición a la app normal con la db adoptada.
      setSeedState({ status: "ready" });
      // W2 — instalar con éxito limpia el descarte y retira el aviso.
      setNotice((prev) => settleNotice(prev));
      try {
        const current = storeRef.current;
        if (current) await clearDismissedVersion(current);
      } catch {
        // best-effort: el aviso ya se retiró
      }
      if (seedTimerRef.current) clearTimeout(seedTimerRef.current);
      seedTimerRef.current = setTimeout(() => setSeedState(null), 1200);
    } catch (e) {
      setSeedState({
        status: "error",
        message: seedErrorCopy(e),
        canRetry: true,
        textOnly: true,
      });
    }
  };

  const retrySeed = async (): Promise<void> => {
    const req = seedRequestRef.current;
    if (!req) {
      setSeedState(null);
      return;
    }
    await runSeedInternal(req.baseUrl, req.remote, req.serverTime);
  };

  const continueTextOnly = (): void => {
    seedRequestRef.current = null;
    setSeedState(null);
    // W2 — salir del flujo también retira el aviso pendiente.
    setNotice((prev) => settleNotice(prev));
  };

  /** W2 — posponer el aviso para esta versión (persiste §W2.4). */
  const dismissUpdate = (): void => {
    setNotice((prev) => {
      const next = dismissNoticeState(prev);
      if (next.status === "dismissed") {
        const current = storeRef.current;
        if (current) {
          writeDismissedVersion(current, next.remote).catch(() => {});
        }
      }
      return next;
    });
  };

  /** W2 — descargar ahora: delega a `runSeedInternal` vigente. */
  const acceptUpdate = async (): Promise<void> => {
    const req = seedRequestRef.current;
    if (!req) {
      setNotice((prev) => settleNotice(prev));
      return;
    }
    setNotice((prev) => acceptNoticeState(prev));
    // Aceptar limpia el descarte (spec §W2.4).
    try {
      const current = storeRef.current;
      if (current) await clearDismissedVersion(current);
    } catch {
      // best-effort: la descarga sigue igual
    }
    await runSeedInternal(req.baseUrl, req.remote, req.serverTime);
  };

  // open db once
  useEffect(() => {
    let alive = true;
    (async () => {
      // Primera instalación: si hay una BD pre-poblada en el bundle (assets/piiyaak.db),
      // copiarla antes de abrir, para tener el diccionario offline desde el primer arranque.
      // Defensa (v1.2): una BD viva VACÍA o corrupta (0 palabras / sin tabla words)
      // no sobrevive al contenido embebido — se reinstala desde el bundle. Una BD
      // con datos NUNCA se toca (progreso local).
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
          } else {
            const probe = openDatabaseSync("piiyaak.db");
            let needsReseed = false;
            try {
              const row = await probe.getFirstAsync<{ n: number }>(
                "SELECT COUNT(*) AS n FROM words"
              );
              needsReseed = !row || row.n === 0;
            } catch {
              needsReseed = true; // sin tabla words o DB ilegible
            }
            await probe.closeAsync();
            if (needsReseed) {
              await FileSystem.deleteAsync(dbPath, { idempotent: true });
              await FileSystem.copyAsync({ from: asset.localUri, to: dbPath });
            }
          }
        }
      } catch {
        // Sin asset pre-poblado (Expo Go / dev): se siembra por red.
      }
      const db = openDatabaseSync("piiyaak.db");
      dbRef.current = db;
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

  // W3 — chequeo del seed en segundo plano tras la apertura instantánea.
  // La db viva sigue sirviendo lectura; si el gate decide `seed`, el flujo
  // §4.2–§4.5 corre con pantalla de progreso y swap atómico.
  useEffect(() => {
    if (!store) return;
    let alive = true;
    (async () => {
      const baseUrl = seedBaseUrl();
      if (!baseUrl) return;
      let remote: { contentVersion: string; serverTime: string };
      try {
        const local = await getLocalVersion(storeRef.current ?? store);
        remote = await getRemoteVersion(null);
        const move = compareVersions(local.contentVersion, remote.contentVersion);
        if (move.action === "skip") return;
        if (move.action === "noop") {
          console.warn(
            `[seed] noop sin downgrade (D3): remote ${remote.contentVersion} < local ${local.contentVersion} — se mantiene local (${move.reason})`
          );
          return;
        }
        if (!alive) return;
        seedRequestRef.current = { baseUrl, remote: move.remote, serverTime: remote.serverTime };
        // W2 — aviso antes de descargar: metadatos best-effort de
        // `latest.json` (solo display) + descarte persistido por versión.
        // `latest.json` ilegible/inválido/divergente → aviso con nulls;
        // sin red → el `catch` vigente: sin aviso (regla §W2.1.3).
        const raw = await fetchLatestJson(baseUrl);
        if (!alive) return;
        const metadata = metadataOrNull(raw, move.remote);
        let dismissed: string | null = null;
        try {
          dismissed = await readDismissedVersion(storeRef.current ?? store);
        } catch {
          dismissed = null;
        }
        if (!alive) return;
        const decided = decideNotice({
          local: local.contentVersion,
          remote: move.remote,
          serverTime: remote.serverTime,
          dismissed,
          metadata,
        });
        setNotice(decided);
        // `available` → la UI decide (descargar/posponer);
        // `dismissed` → el aviso nace pospuesto, sin descarga.
        return;
      } catch {
        // Offline o gate inalcanzable: la app sigue con el texto local.
        if (alive) setSeedState(null);
        if (alive) setNotice({ status: "none" });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

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
      const baseUrl = seedBaseUrl();
      await syncNow(store, session, (done, total) => setSyncProgress({ done, total }), {
        runSeed: baseUrl
          ? async (remote, serverTime) => {
              seedRequestRef.current = { baseUrl, remote, serverTime };
              await runSeedInternal(baseUrl, remote, serverTime);
            }
          : undefined,
      });
      // B3-04: poblado + poda solo tras sync exitosa (si `syncNow` lanza,
      // no se llega acá: nunca tras sync fallida). Best-effort: un fallo
      // de medios no revierte el sync; las favoritas nunca se podan.
      // Tras un seed, el swap reemplazó los stores: se usa la ref vigente.
      const current = storeRef.current ?? store;
      try {
        await refreshMediaAfterSync(current, defaultMediaCache(), { favorites });
      } catch {
        // best-effort: el diccionario ya sincronizó
      }
      // Los cursos también se sincronizan con el sync global (Ajustes):
      // best-effort, nunca rompe el sync del diccionario.
      try {
        const cs = courseStoreRef.current;
        if (cs) {
          const { syncCourses } = await import("./db/sync-courses");
          await syncCourses(cs, session);
        }
      } catch {
        // best-effort: el diccionario ya sincronizó
      }
      if (session) await flushOutbox(current, session).catch(() => {});
      setLastSync(await current.getLastSync());
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
      updateAvailable: notice.status === "available" ? notice.update : null,
      dismissUpdate,
      acceptUpdate,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, courseStore, syncing, syncProgress, lastSync, favorites, historyWords, pendingOutboxCount, seedState, notice]
  );
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb fuera de DbProvider");
  return ctx;
}
