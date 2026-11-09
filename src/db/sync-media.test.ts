import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("expo-file-system", () => import("./__mocks__/expo-file-system"));

import { MemoryWordStore } from "./memory-store";
import { createMediaCache, createMemoryMediaStore } from "./media-cache";
import { refreshMediaAfterSync, syncNowAndRefreshMedia } from "./sync-media";
import type { WordRow } from "./types";

const NOW = "2026-11-09T00:00:00.000Z";
const BASE = "file:///mock-doc/";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

function word(overrides: Partial<WordRow> = {}): WordRow {
  return {
    id: "w1",
    spanish: "agua",
    nasaYuwe: "yu",
    pronunciation: null,
    audioUrl: "https://cdn.example.com/audio/agua.mp3",
    illustrationUrl: "https://cdn.example.com/img/agua.png",
    culturalContext: null,
    category: "casa",
    examples: null,
    status: "PUBLISHED",
    updatedAt: NOW,
    ...overrides,
  };
}

/** fetch mock con ruteo por URL para el gate + seed de `syncNow`. */
function mockSyncRoutes(opts: {
  version: { contentVersion: string; serverTime: string } | { status: number };
  seedPages?: Array<{
    words: WordRow[];
    total: number;
    totalPages: number;
    serverTime: string;
  }>;
}) {
  const seedPages = [...(opts.seedPages ?? [])];
  const mock = vi.fn(async (url: string) => {
    if (url.includes("/api/sync/version")) {
      if ("status" in opts.version) {
        return {
          ok: false,
          status: opts.version.status,
          json: async () => ({}),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => opts.version,
      } as unknown as Response;
    }
    if (url.includes("/api/sync/seed")) {
      const page = seedPages.shift() ?? {
        words: [],
        total: 0,
        totalPages: 0,
        serverTime: NOW,
      };
      return {
        ok: true,
        status: 200,
        json: async () => page,
      } as unknown as Response;
    }
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * B3-04 (hueco funcional B3): `populateMediaCache` + poda existen y están
 * testeados pero ningún flujo los invoca. Este test cierra el hueco:
 * tras `syncNow` exitosa los medios del manifiesto quedan cacheados y los
 * fuera de manifiesto se podan (salvo favoritas).
 */
describe("sync + media-cache cableados (B3-04)", () => {
  it("tras syncNow exitosa puebla medios del manifiesto y poda huerfanos salvo favoritas", async () => {
    const w1 = word({ audioSha256: SHA_A, illustrationSha256: SHA_B });
    const w2 = word({
      id: "w2",
      spanish: "fuego",
      nasaYuwe: "ip",
      audioUrl: "https://cdn.example.com/audio/fuego.mp3",
      illustrationUrl: "https://cdn.example.com/img/fuego.png",
      audioSha256: SHA_C,
      illustrationSha256: SHA_D,
    });
    mockSyncRoutes({
      version: { contentVersion: "1", serverTime: NOW },
      seedPages: [
        { words: [w1, w2], total: 2, totalPages: 1, serverTime: NOW },
      ],
    });
    const store = new MemoryWordStore();
    const media = createMemoryMediaStore(BASE);
    const cache = createMediaCache(media, { baseDir: BASE });
    // Huérfano previo + archivo heredado (pre-B3) de una favorita.
    media.__files().set(`${BASE}audios/orphan.mp3`, "bytes-of:old");
    media.__files().set(`${BASE}audios/fav.mp3`, "bytes-of:legacy");

    const { sync, media: result } = await syncNowAndRefreshMedia(
      store,
      null,
      cache,
      { favorites: ["fav"] }
    );

    expect(sync.applied).toBe(2);
    // Medios del manifiesto quedan cacheados.
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toBe(0);
    expect(result.rows).toHaveLength(4);
    for (const uri of result.ok) {
      expect((await media.getInfo(uri)).exists).toBe(true);
    }
    expect(await store.listManifest()).toHaveLength(4);
    // Poda: solo el huérfano; favorita conservada y referenciados intactos.
    expect(result.pruned.removed).toBe(1);
    expect((await media.getInfo(`${BASE}audios/orphan.mp3`)).exists).toBe(
      false
    );
    expect((await media.getInfo(`${BASE}audios/fav.mp3`)).exists).toBe(true);
    expect(media.__files().size).toBe(5);
  });

  it("tras sync fallida no puebla ni poda", async () => {
    mockSyncRoutes({ version: { status: 500 } });
    const store = new MemoryWordStore();
    const media = createMemoryMediaStore(BASE);
    const cache = createMediaCache(media, { baseDir: BASE });
    media.__files().set(`${BASE}audios/orphan.mp3`, "bytes-of:old");

    await expect(
      syncNowAndRefreshMedia(store, null, cache, { favorites: [] })
    ).rejects.toThrow();
    // Sin poblado ni poda: manifiesto vacío y archivos intactos.
    expect(await store.listManifest()).toHaveLength(0);
    expect((await media.getInfo(`${BASE}audios/orphan.mp3`)).exists).toBe(
      true
    );
    expect(media.__files().size).toBe(1);
  });

  it("refreshMediaAfterSync pagina el diccionario completo", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      word({ id: "w1", audioSha256: SHA_A, illustrationSha256: SHA_B }),
      word({
        id: "w2",
        spanish: "fuego",
        nasaYuwe: "ip",
        audioUrl: "https://cdn.example.com/audio/fuego.mp3",
        illustrationUrl: "https://cdn.example.com/img/fuego.png",
        audioSha256: SHA_C,
        illustrationSha256: SHA_D,
      }),
    ]);
    const media = createMemoryMediaStore(BASE);
    const cache = createMediaCache(media, { baseDir: BASE });

    const result = await refreshMediaAfterSync(store, cache, {
      favorites: [],
      pageSize: 1,
    });

    expect(result.rows).toHaveLength(4);
    expect(result.failed).toHaveLength(0);
    expect(result.pruned.removed).toBe(0);
    expect(await store.listManifest()).toHaveLength(4);
  });
});
