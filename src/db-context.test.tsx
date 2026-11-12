import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, type SessionState } from "./api";
import { DbProvider, useDb } from "./db-context";
import type { SyncResult, WordRow } from "./db/types";

/**
 * `DbProvider` / `useDb`: outbox, favoritos, historial, sync y estados.
 *
 * Se prueba contra SQLite real: `expo-sqlite` se mockea con el shim de Fase 1
 * (`src/db/__tests__/node-sqlite-shim.ts`), así que el SQL de producción
 * (`SQLiteWordStore`) corre contra una base en memoria de verdad.
 *
 * Todo lo que el provider usa como colaborador (red, sync, medios) se
 * mockea localmente a este archivo; no se toca `jest.setup.tsx` ni código
 * de producción.
 */

jest.mock("./api", () => {
  const actual = jest.requireActual<typeof import("./api")>("./api");
  return {
    ...actual,
    apiFetch: jest.fn(),
  };
});

jest.mock("./auth", () => ({
  __esModule: true,
  AUTH_UI_ENABLED: false,
  useAuth: () => mockAuthState,
}));

jest.mock("./db/sync", () => ({
  __esModule: true,
  syncNow: jest.fn(),
  flushOutbox: jest.fn(),
}));

jest.mock("./db/sync-media", () => ({
  __esModule: true,
  refreshMediaAfterSync: jest.fn(),
}));

jest.mock("./db/sync-courses", () => ({
  __esModule: true,
  syncCourses: jest.fn(),
}));

jest.mock("./audio", () => ({
  __esModule: true,
  downloadWordAudio: jest.fn(async () => undefined),
  removeWordAudio: jest.fn(async () => undefined),
}));

jest.mock("./illustrations", () => ({
  __esModule: true,
  downloadWordIllustration: jest.fn(async () => undefined),
  removeWordIllustration: jest.fn(async () => undefined),
}));

jest.mock("expo-sqlite", () => {
  // Shim de Fase 1: `node:sqlite` en memoria con la interfaz async de
  // `expo-sqlite`. Cada apertura devuelve una base nueva y aislada.
  const { openNodeSqlite } = require("./db/__tests__/node-sqlite-shim");
  const openDatabaseSync = jest.fn(() => {
    const handle = openNodeSqlite();
    return Object.assign(handle.db, {
      closeAsync: async () => {
        handle.close();
      },
    });
  });
  return {
    __esModule: true,
    openDatabaseSync,
    openDatabaseAsync: jest.fn(async () => openNodeSqlite().db),
  };
});

jest.mock("expo-asset", () => ({
  __esModule: true,
  Asset: {
    fromModule: jest.fn(() => ({
      downloadAsync: jest.fn(async () => undefined),
      localUri: null,
      uri: null,
    })),
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  __esModule: true,
  documentDirectory: "file:///tmp/piiyaak/",
  makeDirectoryAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async () => ({ uri: "file:///tmp/piiyaak/medio" })),
  readDirectoryAsync: jest.fn(async () => []),
  createDownloadResumable: jest.fn(),
}));

import { syncNow, flushOutbox } from "./db/sync";
import { refreshMediaAfterSync } from "./db/sync-media";
import { syncCourses } from "./db/sync-courses";
import { downloadWordAudio, removeWordAudio } from "./audio";
import { downloadWordIllustration, removeWordIllustration } from "./illustrations";

const mockApiFetch = jest.mocked(apiFetch);
const mockSyncNow = jest.mocked(syncNow);
const mockFlushOutbox = jest.mocked(flushOutbox);
const mockRefreshMedia = jest.mocked(refreshMediaAfterSync);
const mockSyncCourses = jest.mocked(syncCourses);
const mockDownloadAudio = jest.mocked(downloadWordAudio);
const mockRemoveAudio = jest.mocked(removeWordAudio);
const mockDownloadIllustration = jest.mocked(downloadWordIllustration);
const mockRemoveIllustration = jest.mocked(removeWordIllustration);
const mockFromModule = jest.mocked(Asset.fromModule);
const mockMakeDirectory = jest.mocked(FileSystem.makeDirectoryAsync);
const mockGetInfo = jest.mocked(FileSystem.getInfoAsync);
const mockCopy = jest.mocked(FileSystem.copyAsync);
const mockDeleteAsync = jest.mocked(FileSystem.deleteAsync);

const SESSION: SessionState = {
  cookie: "next-auth.session-token=abc",
  user: { id: "u1", email: "ana@example.com", name: "Ana", role: "user" },
};

/** Clave de persistencia de las favoritas (misma que usa `db-context`). */
const FAV_KEY = "piiyaak:favs";

/** Estado de autenticación que ve el provider (módulo `./auth` mockeado). */
let mockAuthState: { session: SessionState | null; ready: boolean } = {
  session: null,
  ready: true,
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeWord(id: string, over: Partial<WordRow> = {}): WordRow {
  return {
    id,
    spanish: `palabra-${id}`,
    nasaYuwe: `palabra-${id}`,
    pronunciation: null,
    audioUrl: null,
    illustrationUrl: null,
    culturalContext: null,
    category: null,
    examples: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <DbProvider>{children}</DbProvider>
);

/** Monta el provider y espera a que la base esté abierta (`ready`). */
async function mountDb() {
  const view = renderHook(() => useDb(), { wrapper });
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

/** Estado que expone el provider (misma forma que devuelve `useDb()`). */
type DbState = ReturnType<typeof useDb>;

/** `toggleFavorite` siempre pasa por `act`: muta estado del provider. */
async function toggleFavorite(
  view: { result: { current: DbState } },
  word: WordRow
): Promise<void> {
  await act(async () => {
    await view.result.current.toggleFavorite(word);
  });
}

describe("DbProvider / useDb", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthState = { session: null, ready: true };

    mockApiFetch.mockReset();
    mockApiFetch.mockResolvedValue(jsonResponse({}));

    mockSyncNow.mockReset();
    mockSyncNow.mockResolvedValue({
      applied: 0,
      removed: 0,
      serverTime: null,
      hasMore: false,
    });

    mockFlushOutbox.mockReset();
    mockFlushOutbox.mockResolvedValue(undefined);

    mockRefreshMedia.mockReset();
    mockRefreshMedia.mockResolvedValue({
      rows: [],
      ok: [],
      failed: [],
      skipped: 0,
      pruned: { removed: 0 },
    });

    mockSyncCourses.mockReset();
    mockSyncCourses.mockResolvedValue({ courses: 0, modules: 0, lessons: 0 });

    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("estado inicial", () => {
    it("expone store y courseStore y queda ready cuando la base abre", async () => {
      const { result } = await mountDb();

      expect(result.current.ready).toBe(true);
      expect(result.current.store).not.toBeNull();
      expect(result.current.courseStore).not.toBeNull();
      // La base real (shim de node:sqlite) responde consultas.
      await expect(result.current.store?.count()).resolves.toBe(0);
    });

    it("arranca sin favoritas ni historial", async () => {
      const { result } = await mountDb();

      expect(result.current.favorites).toEqual([]);
      expect(result.current.history).toEqual([]);
      expect(result.current.pendingOutboxCount).toBe(0);
      expect(result.current.lastSync).toBeNull();
      expect(result.current.syncing).toBe(false);
      expect(result.current.syncProgress).toBeNull();
    });

    it("no hay aviso de actualización ni seed activo en el arranque", async () => {
      const { result } = await mountDb();

      expect(result.current.updateAvailable).toBeNull();
      expect(result.current.seedState).toBeNull();
    });

    it("useDb fuera del provider lanza un error explícito", () => {
      expect(() => renderHook(() => useDb())).toThrow("useDb fuera de DbProvider");
    });
  });

  describe("outbox: toggleFavorite", () => {
    it("encola la entrada correcta en el outbox al favoritar", async () => {
      const { result } = await mountDb();
      const word = makeWord("w1");

      await toggleFavorite({ result }, word);

      const pending = await result.current.store?.pendingOutbox();
      expect(pending).toHaveLength(1);
      expect(pending?.[0]).toMatchObject({
        entity: "favorite",
        op: "favorite.add",
        payload: JSON.stringify({ wordId: "w1" }),
      });
      await waitFor(() => expect(result.current.pendingOutboxCount).toBe(1));
      expect(result.current.favorites).toEqual(["w1"]);
    });

    it("encola favorite.remove al quitar una favorita", async () => {
      const { result } = await mountDb();
      const word = makeWord("w1");

      await toggleFavorite({ result }, word);
      await toggleFavorite({ result }, word);

      const pending = await result.current.store?.pendingOutbox();
      expect(pending?.map((r) => r.op)).toEqual(["favorite.add", "favorite.remove"]);
      expect(result.current.favorites).toEqual([]);
    });

    it("marca como sincronizada la entrada que encoló (POST ok)", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockResolvedValue(jsonResponse({ ok: true }));

      const { result } = await mountDb();
      const word = makeWord("w1");

      await toggleFavorite({ result }, word);

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/dictionary/favorites",
        { method: "POST", body: JSON.stringify({ wordId: "w1" }) },
        SESSION
      );
      // La entrada encolada quedó confirmada: no queda nada pendiente.
      const pending = await result.current.store?.pendingOutbox();
      expect(pending).toHaveLength(0);
      await waitFor(() => expect(result.current.pendingOutboxCount).toBe(0));
    });

    it("deja la entrada pendiente si la red falla al empujar la favorita", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockRejectedValue(new Error("sin red"));

      const { result } = await mountDb();
      const word = makeWord("w1");

      await toggleFavorite({ result }, word);

      // Queda encolada para reintentar: no se pierde el cambio.
      const pending = await result.current.store?.pendingOutbox();
      expect(pending).toHaveLength(1);
      expect(pending?.[0]?.op).toBe("favorite.add");
      await waitFor(() => expect(result.current.pendingOutboxCount).toBe(1));
    });

    it.failing(
      "[bug] NO marca la entrada como sincronizada si el servidor responde con error",
      async () => {
        // FALLO DE PRODUCCIÓN (src/db-context.tsx:522-531): el POST a
        // /api/dictionary/favorites no chequea `res.ok`. Si el servidor
        // rechaza la operación (401/500), la entrada del outbox se marca
        // igual como sincronizada y NUNCA se reintenta: la favorita se
        // pierde de forma silenciosa.
        mockAuthState = { session: SESSION, ready: true };
        mockApiFetch.mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));

        const { result } = await mountDb();
        const word = makeWord("w1");

        await toggleFavorite({ result }, word);

        const pending = await result.current.store?.pendingOutbox();
        expect(pending).toHaveLength(1);
        expect(pending?.[0]?.syncedAt).toBeNull();
      }
    );

    it("descarga audio e ilustración al favoritar y los borra al desfavoritar", async () => {
      const { result } = await mountDb();
      const word = makeWord("w1", {
        audioUrl: "https://cdn.example.com/w1.mp3",
        illustrationUrl: "https://cdn.example.com/w1.png",
        audioSha256: "aaa",
        illustrationSha256: "bbb",
      });

      await toggleFavorite({ result }, word);

      expect(mockDownloadAudio).toHaveBeenCalledWith({
        id: "w1",
        audioUrl: "https://cdn.example.com/w1.mp3",
        audioSha256: "aaa",
      });
      expect(mockDownloadIllustration).toHaveBeenCalledWith({
        id: "w1",
        illustrationUrl: "https://cdn.example.com/w1.png",
        illustrationSha256: "bbb",
      });

      await toggleFavorite({ result }, word);

      expect(mockRemoveAudio).toHaveBeenCalledWith({
        id: "w1",
        audioUrl: "https://cdn.example.com/w1.mp3",
        audioSha256: "aaa",
      });
      expect(mockRemoveIllustration).toHaveBeenCalledWith({
        id: "w1",
        illustrationUrl: "https://cdn.example.com/w1.png",
        illustrationSha256: "bbb",
      });
    });
  });

  describe("historial: pushHistory", () => {
    it("guarda el historial local y lo expone en history", async () => {
      const { result } = await mountDb();
      const word = makeWord("w1");
      await result.current.store?.upsertWords([word]);

      await act(async () => {
        result.current.pushHistory(word);
      });

      await waitFor(() => expect(result.current.history).toHaveLength(1));
      expect(result.current.history[0]).toMatchObject({ id: "w1" });
      await expect(result.current.store?.listHistory()).resolves.toEqual(["w1"]);
    });

    it("sin sesión encola el historial en el outbox para el próximo sync", async () => {
      const { result } = await mountDb();
      const word = makeWord("w1");

      await act(async () => {
        result.current.pushHistory(word);
      });

      await waitFor(async () => {
        const pending = await result.current.store?.pendingOutbox();
        expect(pending).toHaveLength(1);
        expect(pending?.[0]).toMatchObject({
          entity: "history",
          op: "history.view",
          payload: JSON.stringify({ wordId: "w1" }),
        });
      });
      expect(mockApiFetch).not.toHaveBeenCalledWith(
        "/api/dictionary/history",
        expect.anything(),
        expect.anything()
      );
    });

    it("con sesión manda el historial al servidor", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockResolvedValue(jsonResponse({ ok: true }));

      const { result } = await mountDb();
      const word = makeWord("w1");

      await act(async () => {
        result.current.pushHistory(word);
      });

      await waitFor(() =>
        expect(mockApiFetch).toHaveBeenCalledWith(
          "/api/dictionary/history",
          { method: "POST", body: JSON.stringify({ wordId: "w1" }) },
          SESSION
        )
      );
    });

    it.failing(
      "[bug] con sesión y red caída deja el historial encolado para no perderlo",
      async () => {
        // FALLO DE PRODUCCIÓN (src/db-context.tsx:543-547): con sesión
        // activa el historial se manda directo al servidor y NUNCA se
        // encola en el outbox. Si la red falla, el historial queda solo en
        // el dispositivo: al cambiar de dispositivo se pierde.
        mockAuthState = { session: SESSION, ready: true };
        mockApiFetch.mockRejectedValue(new Error("sin red"));

        const { result } = await mountDb();
        const word = makeWord("w1");

        await act(async () => {
          result.current.pushHistory(word);
        });

        await waitFor(async () => {
          const pending = await result.current.store?.pendingOutbox();
          expect(pending).toHaveLength(1);
          expect(pending?.[0]?.entity).toBe("history");
        });
      }
    );
  });

  describe("merge de favoritas al iniciar sesión", () => {
    it("agrega las favoritas del servidor a las locales", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockResolvedValue(
        jsonResponse({ favorites: [{ wordId: "srv-1" }, { wordId: "srv-2" }] })
      );

      const { result } = await mountDb();

      await waitFor(() => expect(result.current.favorites).toEqual(["srv-1", "srv-2"]));
      expect(mockApiFetch).toHaveBeenCalledWith("/api/dictionary/favorites", {}, SESSION);
    });

    it("no cambia las favoritas cuando el servidor no devuelve ninguna", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockResolvedValue(jsonResponse({}));

      const { result } = await mountDb();

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
      expect(result.current.favorites).toEqual([]);
    });

    it("no cambia las favoritas cuando la request de favoritas falla", async () => {
      mockAuthState = { session: SESSION, ready: true };
      mockApiFetch.mockResolvedValue(jsonResponse({ error: "boom" }, false, 500));

      const { result } = await mountDb();

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
      expect(result.current.favorites).toEqual([]);
    });
  });

  describe("persistencia de favoritas", () => {
    it.failing("[bug] recupera las favoritas guardadas en AsyncStorage al abrir", async () => {
      // FALLO DE PRODUCCIÓN (src/db-context.tsx:365-367 contra
      // src/db-context.tsx:285-290): el efecto que persiste las favoritas
      // escribe `[]` en el arranque, antes de que el efecto de apertura
      // lea el valor guardado. Las favoritas persistidas se pisan y la app
      // arranca siempre sin favoritas.
      await AsyncStorage.setItem(FAV_KEY, JSON.stringify(["w-local"]));

      const { result } = await mountDb();

      await waitFor(() => expect(result.current.favorites).toEqual(["w-local"]));
    });

    it("persiste las favoritas cuando el usuario favorita una palabra", async () => {
      const { result } = await mountDb();

      await toggleFavorite({ result }, makeWord("w1"));

      await waitFor(async () => {
        await expect(AsyncStorage.getItem(FAV_KEY)).resolves.toBe(JSON.stringify(["w1"]));
      });
    });
  });

  describe("aviso de contenido nuevo (W2)", () => {
    const SEED_URL = "https://seed.example.com";

    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SEED_BASE_URL;
    });

    it("expone el aviso cuando la versión remota es mayor que la local", async () => {
      process.env.EXPO_PUBLIC_SEED_BASE_URL = SEED_URL;
      mockApiFetch.mockResolvedValue(
        jsonResponse({ contentVersion: "2", serverTime: "2026-02-02T00:00:00.000Z" })
      );
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse({
          contentVersion: "2",
          manifestUrl: "https://seed.example.com/manifest.json",
          zipUrl: "https://seed.example.com/seed.zip",
          bytesTotal: 1024,
          files: 7,
          updatedAt: "2026-02-02T00:00:00.000Z",
        }) as unknown as Response
      );

      const { result } = await mountDb();

      await waitFor(() =>
        expect(result.current.updateAvailable).toEqual({
          remote: "2",
          serverTime: "2026-02-02T00:00:00.000Z",
          bytesTotal: 1024,
          files: 7,
        })
      );
      expect(mockApiFetch).toHaveBeenCalledWith("/api/sync/version", {}, null);
    });

    it("dismissUpdate retira el aviso y persiste el descarte", async () => {
      process.env.EXPO_PUBLIC_SEED_BASE_URL = SEED_URL;
      mockApiFetch.mockResolvedValue(
        jsonResponse({ contentVersion: "2", serverTime: "2026-02-02T00:00:00.000Z" })
      );
      jest.spyOn(global, "fetch").mockResolvedValue(
        jsonResponse(null, false, 404) as unknown as Response
      );

      const { result } = await mountDb();
      await waitFor(() => expect(result.current.updateAvailable).not.toBeNull());

      act(() => {
        result.current.dismissUpdate();
      });

      expect(result.current.updateAvailable).toBeNull();
      await waitFor(async () => {
        await expect(result.current.store?.getKV("piiyaak:dismissedUpdate")).resolves.toBe("2");
      });
    });

    it("sin versiongate disponible no expone aviso", async () => {
      process.env.EXPO_PUBLIC_SEED_BASE_URL = SEED_URL;
      mockApiFetch.mockRejectedValue(new Error("sin red"));

      const { result } = await mountDb();

      await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
      expect(result.current.updateAvailable).toBeNull();
      expect(result.current.seedState).toBeNull();
    });
  });

  describe("base embebida en el bundle", () => {
    const BUNDLE_URI = "file:///bundle/piiyaak.db";

    it("copia la base embebida al disco en la primera instalación", async () => {
      mockFromModule.mockReturnValueOnce({
        downloadAsync: jest.fn(async () => undefined),
        localUri: BUNDLE_URI,
        uri: BUNDLE_URI,
      } as unknown as ReturnType<typeof Asset.fromModule>);
      mockGetInfo.mockResolvedValueOnce({ exists: false } as never);

      await mountDb();

      expect(mockMakeDirectory).toHaveBeenCalledWith("file:///tmp/piiyaak/SQLite", {
        intermediates: true,
      });
      expect(mockCopy).toHaveBeenCalledWith({
        from: BUNDLE_URI,
        to: "file:///tmp/piiyaak/SQLite/piiyaak.db",
      });
    });

    it("reinstala la base embebida si la base viva está vacía", async () => {
      mockFromModule.mockReturnValueOnce({
        downloadAsync: jest.fn(async () => undefined),
        localUri: BUNDLE_URI,
        uri: BUNDLE_URI,
      } as unknown as ReturnType<typeof Asset.fromModule>);
      mockGetInfo.mockResolvedValueOnce({ exists: true } as never);

      await mountDb();

      // La base viva estaba vacía: se borra y se vuelve a copiar la del bundle.
      expect(mockDeleteAsync).toHaveBeenCalledWith("file:///tmp/piiyaak/SQLite/piiyaak.db", {
        idempotent: true,
      });
      expect(mockCopy).toHaveBeenCalledWith({
        from: BUNDLE_URI,
        to: "file:///tmp/piiyaak/SQLite/piiyaak.db",
      });
    });
  });

  describe("control del seed (W3)", () => {
    it("continuar solo con texto deja el estado del seed y el aviso en null", async () => {
      const { result } = await mountDb();

      act(() => {
        result.current.continueTextOnly();
      });

      expect(result.current.seedState).toBeNull();
      expect(result.current.updateAvailable).toBeNull();
    });

    it("retrySeed sin pedido deja el estado del seed en null", async () => {
      const { result } = await mountDb();

      await act(async () => {
        await result.current.retrySeed();
      });

      expect(result.current.seedState).toBeNull();
    });

    it("acceptUpdate sin pedido retira el aviso", async () => {
      const { result } = await mountDb();

      await act(async () => {
        await result.current.acceptUpdate();
      });

      expect(result.current.updateAvailable).toBeNull();
    });
  });

  describe("sync", () => {
    it("llama a syncNow con el store y la sesión, y expone el progreso", async () => {
      mockAuthState = { session: SESSION, ready: true };
      let onProgress: ((done: number, total: number) => void) | undefined;
      let resolveSync: (() => void) | undefined;
      mockSyncNow.mockImplementation(
        (_store, _session, cb) =>
          new Promise<SyncResult>((resolve) => {
            onProgress = cb;
            resolveSync = () =>
              resolve({ applied: 0, removed: 0, serverTime: null, hasMore: false });
          })
      );

      const { result } = await mountDb();

      let syncPromise: Promise<void> | undefined;
      await act(async () => {
        syncPromise = result.current.sync();
      });

      expect(mockSyncNow).toHaveBeenCalledTimes(1);
      expect(mockSyncNow).toHaveBeenCalledWith(
        result.current.store,
        SESSION,
        expect.any(Function),
        expect.objectContaining({ runSeed: undefined })
      );
      expect(result.current.syncing).toBe(true);

      act(() => {
        onProgress?.(5, 100);
      });
      expect(result.current.syncProgress).toEqual({ done: 5, total: 100 });

      await act(async () => {
        resolveSync?.();
        await syncPromise;
      });

      expect(result.current.syncing).toBe(false);
      expect(result.current.syncProgress).toBeNull();
    });

    it("actualiza lastSync y pendingOutboxCount tras sincronizar", async () => {
      const { result } = await mountDb();
      await result.current.store?.setLastSync("2026-05-05T10:00:00.000Z");
      await result.current.store?.addOutbox("history", "history.view", '{"wordId":"w1"}');

      await act(async () => {
        await result.current.sync();
      });

      expect(result.current.lastSync).toBe("2026-05-05T10:00:00.000Z");
      await waitFor(() => expect(result.current.pendingOutboxCount).toBe(1));
      // La sesión no estaba: no se vació el outbox.
      expect(mockFlushOutbox).not.toHaveBeenCalled();
    });

    it("vuelca el outbox al sincronizar con sesión", async () => {
      mockAuthState = { session: SESSION, ready: true };
      const { result } = await mountDb();

      await act(async () => {
        await result.current.sync();
      });

      expect(mockFlushOutbox).toHaveBeenCalledWith(result.current.store, SESSION);
    });

    it("deja de sincronizar y propaga el error si syncNow falla", async () => {
      mockSyncNow.mockRejectedValue(new Error("red caída"));

      const { result } = await mountDb();

      await act(async () => {
        await expect(result.current.sync()).rejects.toThrow("red caída");
      });

      expect(result.current.syncing).toBe(false);
    });

    it.failing("[bug] el sync global también sincroniza los cursos", async () => {
      // FALLO DE PRODUCCIÓN (src/db-context.tsx:279 contra
      // src/db-context.tsx:448-451): el store de cursos se guarda en el
      // estado (`setCourseStore`) pero NUNCA en `courseStoreRef` (solo
      // `reopenStores`, la ruta del seed, lo hace). Con el arranque
      // normal la ref queda en null y el sync global no sincroniza
      // cursos: la rama de `syncCourses` es código muerto.
      mockAuthState = { session: SESSION, ready: true };
      const { result } = await mountDb();

      await act(async () => {
        await result.current.sync();
      });

      expect(mockSyncCourses).toHaveBeenCalledWith(result.current.courseStore, SESSION);
    });

    it("syncData vuelca el outbox cuando hay sesión", async () => {
      mockAuthState = { session: SESSION, ready: true };
      const { result } = await mountDb();
      await result.current.store?.addOutbox("history", "history.view", '{"wordId":"w1"}');

      await act(async () => {
        await result.current.syncData();
      });

      expect(mockFlushOutbox).toHaveBeenCalledWith(result.current.store, SESSION);
      await waitFor(() => expect(result.current.pendingOutboxCount).toBe(1));
      expect(result.current.syncing).toBe(false);
    });

    it("syncData no vuelca el outbox sin sesión", async () => {
      const { result } = await mountDb();

      await act(async () => {
        await result.current.syncData();
      });

      expect(mockFlushOutbox).not.toHaveBeenCalled();
    });
  });

  describe("outbox al volver al primer plano", () => {
    /** `AppState` viene mockeado por react-native (`addEventListener` es un jest.fn). */
    function appStateHandler(): (state: string) => void {
      const mockAddEventListener = AppState.addEventListener as unknown as jest.Mock<
        (type: string, handler: (state: string) => void) => { remove: () => void }
      >;
      const call = mockAddEventListener.mock.calls.find((c) => c[0] === "change");
      expect(call).toBeDefined();
      return call?.[1] as (state: string) => void;
    }

    it("vuelca el outbox cuando la app vuelve a primer plano con sesión", async () => {
      mockAuthState = { session: SESSION, ready: true };
      const { result } = await mountDb();
      const handler = appStateHandler();

      await act(async () => {
        handler("active");
      });

      expect(mockFlushOutbox).toHaveBeenCalledWith(result.current.store, SESSION);
    });

    it("no vuelca el outbox al volver al primer plano sin sesión", async () => {
      await mountDb();
      const handler = appStateHandler();

      await act(async () => {
        handler("active");
      });

      expect(mockFlushOutbox).not.toHaveBeenCalled();
    });
  });
});
