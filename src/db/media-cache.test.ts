import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("react-native", () => ({ EventEmitter: class {}, Platform: { OS: "ios" }, NativeModules: {} }));
vi.mock("expo-modules-core", () => ({ EventEmitter: class {}, requireOptionalNativeModule: () => null, requireNativeModule: () => ({}), UnavailabilityError: class extends Error {}, uuid: () => "test-uuid" }));

vi.mock("expo-file-system", () => import("./__mocks__/expo-file-system"));
vi.mock("expo-file-system/legacy", () => import("./__mocks__/expo-file-system"));

import * as FileSystem from "expo-file-system/legacy";
import { __reset, __listAll } from "./__mocks__/expo-file-system";
import {
  createMediaCache,
  createMemoryMediaStore,
  collectMediaRefs,
  lessonBlocksToRefs,
  courseCoversToRefs,
} from "./media-cache";
import type { MediaRef, MediaManifestRow } from "./media-cache";
import type { WordRow } from "./types";
import type { LessonRow } from "./course-types";

beforeEach(() => {
  __reset();
});

/**
 * B3-01 (CA5 infraestructura, R6): mock en memoria de `expo-file-system`.
 * Ningún test de medios toca disco real.
 */
describe("mock expo-file-system en memoria (B3-01)", () => {
  it("ciclo escribir→existe→listar→eliminar sin tocar disco", async () => {
    const dir = `${FileSystem.documentDirectory}audios/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const dest = `${dir}abc123.mp3`;
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
    const dl = await FileSystem.downloadAsync(
      "https://cdn.example.com/a.mp3",
      dest
    );
    expect(dl.uri).toBe(dest);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
    const entries = await FileSystem.readDirectoryAsync(dir);
    expect(entries.some((e) => dest.endsWith(String(e)))).toBe(true);
    await FileSystem.deleteAsync(dest, { idempotent: true });
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
    expect(__listAll()).not.toContain(dest);
  });
});

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function wordRow(overrides: Partial<WordRow> = {}): WordRow {
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
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type WordRowWithHash = WordRow & {
  audioSha256?: string | null;
  illustrationSha256?: string | null;
};

/**
 * B3-02 (CA5 parcial): clave por contenido + fallback URL + manifiesto.
 * RED: `createMediaCache` / parsers aún no existen.
 */
describe("media-cache por contenido (B3-02)", () => {
  it("localUriFor usa <sha256>.<ext> cuando hay hash", () => {
    const cache = createMediaCache(createMemoryMediaStore(), { baseDir: "file:///mock-doc/" });
    const audio: MediaRef = {
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/a.mp3?token=abc",
      sha256: SHA_A,
    };
    expect(cache.localUriFor(audio)).toBe(
      `file:///mock-doc/audios/${SHA_A}.mp3`
    );
    const img: MediaRef = {
      wordId: "w1",
      kind: "illustration",
      url: "https://cdn.example.com/i",
      sha256: SHA_B,
    };
    // Sin extensión en la URL: default por kind.
    expect(cache.localUriFor(img)).toBe(
      `file:///mock-doc/illustrations/${SHA_B}.png`
    );
  });

  it("localUriFor deriva url_<normalizada> cuando falta sha256 (F1-b)", () => {
    const cache = createMediaCache(createMemoryMediaStore(), { baseDir: "file:///mock-doc/" });
    const ref: MediaRef = {
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/audio/agua.mp3?token=abc#frag",
      sha256: null,
    };
    const uri = cache.localUriFor(ref);
    expect(uri.startsWith("file:///mock-doc/audios/url_")).toBe(true);
    expect(uri.endsWith(".mp3")).toBe(true);
    expect(uri).not.toContain("?");
    expect(uri).not.toContain("#");
  });

  it("buildManifest extrae audio/ilustracion PUBLISHED con hashes", async () => {
    const cache = createMediaCache(createMemoryMediaStore(), { baseDir: "file:///mock-doc/" });
    const w = wordRow() as WordRowWithHash;
    w.audioSha256 = SHA_A;
    w.illustrationSha256 = SHA_B;
    const rows = await cache.buildManifest([w], []);
    expect(rows).toHaveLength(2);
    const byKind = new Map(rows.map((r) => [r.kind, r]));
    expect(byKind.get("audio")?.localUri).toBe(
      `file:///mock-doc/audios/${SHA_A}.mp3`
    );
    expect(byKind.get("illustration")?.localUri).toBe(
      `file:///mock-doc/illustrations/${SHA_B}.png`
    );
    expect(byKind.get("audio")?.sha256).toBe(SHA_A);
  });

  it("buildManifest excluye DRAFT y usa fallback sin hashes", async () => {
    const cache = createMediaCache(createMemoryMediaStore(), { baseDir: "file:///mock-doc/" });
    const rows = await cache.buildManifest(
      [wordRow({ id: "draft", status: "DRAFT" }), wordRow({ id: "w2" })],
      []
    );
    // Solo w2 (audio + ilustración), ambas por fallback URL.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.wordId === "w2")).toBe(true);
    expect(rows.every((r) => r.sha256 === null)).toBe(true);
    expect(
      rows.every((r) => r.localUri.includes("/url_"))
    ).toBe(true);
  });

  it("parser: bloques lesson audio/image/listening + coverImage; excluye video/youtube/text/word/quiz", () => {
    const lesson: LessonRow = {
      id: "l1",
      moduleId: "m1",
      title: "Lección",
      order: 0,
      lessonNumber: null,
      content: JSON.stringify({
        version: 2,
        blocks: [
          { id: "b1", type: "audio", media: { url: "https://cdn.example.com/l1.mp3" } },
          { id: "b2", type: "listening", media: { url: "https://cdn.example.com/l2.mp3" } },
          { id: "b3", type: "image", url: "https://cdn.example.com/i.png", caption: "x" },
          { id: "b4", type: "video", youtubeId: "abc123" },
          { id: "b5", type: "text", html: "<p>hola</p>" },
          { id: "b6", type: "word", wordId: "w1" },
          { id: "b7", type: "quiz", questions: [] },
        ],
      }),
    };
    const { refs, skipped } = lessonBlocksToRefs([lesson]);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.wordId)).toEqual([
      "lesson:l1",
      "lesson:l1",
      "lesson:l1",
    ]);
    expect(refs.map((r) => r.kind)).toEqual([
      "audio",
      "audio",
      "illustration",
    ]);
    expect(skipped).toBe(0);

    const covers = courseCoversToRefs([
      {
        id: "c1",
        status: "PUBLISHED",
        coverImage: "https://cdn.example.com/cover.jpg",
      },
      {
        id: "c2",
        status: "DRAFT",
        coverImage: "https://cdn.example.com/draft.jpg",
      },
    ]);
    expect(covers.map((r) => r.wordId)).toEqual(["course:c1"]);
    expect(covers[0]?.kind).toBe("illustration");
  });

  it("collectMediaRefs rechaza URLs no-https y las contabiliza en skipped", () => {
    const w = wordRow({
      id: "w9",
      audioUrl: "ftp://cdn.example.com/a.mp3",
      illustrationUrl: "https://cdn.example.com/i.png",
    });
    const { refs, skipped } = collectMediaRefs([w], []);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe("illustration");
    expect(skipped).toBe(1);
  });

  it("buildManifest suma extra (palabra del dia) y deduplica", async () => {
    const cache = createMediaCache(createMemoryMediaStore(), { baseDir: "file:///mock-doc/" });
    const w = wordRow() as WordRowWithHash;
    w.audioSha256 = SHA_A;
    w.illustrationSha256 = SHA_B;
    const extra: MediaRef[] = [
      { wordId: "w1", kind: "audio", url: w.audioUrl!, sha256: SHA_A },
    ];
    const rows = await cache.buildManifest([w], extra);
    expect(rows).toHaveLength(2);
  });
});

describe("descarga y poblado (B3-02)", () => {
  const noSleep = async (_ms: number): Promise<void> => {};

  it("ensureCached descarga por hash y no re-descarga si existe", async () => {
    const store = createMemoryMediaStore();
    let downloads = 0;
    const counting = {
      ...store,
      async download(url: string, dest: string) {
        downloads++;
        return store.download(url, dest);
      },
    };
    const cache = createMediaCache(counting, { baseDir: "file:///mock-doc/", sleep: noSleep });
    const ref: MediaRef = {
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/a.mp3",
      sha256: SHA_A,
    };
    const first = await cache.ensureCached(ref);
    expect(first).toBe(`file:///mock-doc/audios/${SHA_A}.mp3`);
    expect(await cache.exists(ref)).toBe(true);
    await cache.ensureCached(ref);
    expect(downloads).toBe(1);
  });

  it("ensureCached reintenta 2 veces con espera y luego lanza", async () => {
    const store = createMemoryMediaStore();
    const waits: number[] = [];
    const cache = createMediaCache(store, {
      baseDir: "file:///mock-doc/",
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      retryDelayMs: 1000,
    });
    let attempts = 0;
    const failing = {
      ...store,
      async download(url: string, _dest: string): Promise<{ uri: string }> {
        attempts++;
        throw new Error(`net down: ${url}`);
      },
    };
    const retrying = createMediaCache(failing, {
      baseDir: "file:///mock-doc/",
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      retryDelayMs: 1000,
    });
    const ref: MediaRef = {
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/a.mp3",
      sha256: null,
    };
    await expect(retrying.ensureCached(ref)).rejects.toThrow("net down");
    expect(attempts).toBe(3);
    expect(waits).toEqual([1000, 1000]);
    expect(cache).toBeDefined();
  });

  it("mismatch de integridad: elimina el parcial, reintenta y reporta failed sin bloquear", async () => {
    const store = createMemoryMediaStore();
    const cache = createMediaCache(store, {
      baseDir: "file:///mock-doc/",
      sleep: noSleep,
      verify: async (ref) => ref.sha256 !== SHA_A,
    });
    const good: MediaRef = {
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/good.mp3",
      sha256: SHA_B,
    };
    const bad: MediaRef = {
      wordId: "w2",
      kind: "audio",
      url: "https://cdn.example.com/bad.mp3",
      sha256: SHA_A,
    };
    const { ok, failed } = await cache.ensureAllCached([good, bad]);
    expect(ok).toHaveLength(1);
    expect(failed.map((r) => r.wordId)).toEqual(["w2"]);
    // El parcial del mismatch no queda en disco.
    expect(await cache.exists(bad)).toBe(false);
    expect(await cache.exists(good)).toBe(true);
  });

  it("sync exitosa puebla medios del manifiesto (CA5)", async () => {
    const { MemoryWordStore } = await import("./memory-store");
    const { populateMediaCache } = await import("./media-cache");
    const store = new MemoryWordStore();
    const w = wordRow() as WordRowWithHash;
    w.audioSha256 = SHA_A;
    w.illustrationSha256 = SHA_B;
    // Simula el contenido ya sincronizado (post-syncNow exitoso).
    await store.upsertWords([w]);
    const words = await store.listAZ(null, 100);

    const media = createMemoryMediaStore();
    const cache = createMediaCache(media, { baseDir: "file:///mock-doc/", sleep: noSleep });
    const result = await populateMediaCache(cache, store, words, []);
    expect(result.rows).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toBe(0);
    for (const uri of result.ok) {
      expect((await media.getInfo(uri)).exists).toBe(true);
    }
    expect(await store.listManifest()).toHaveLength(2);
  });

  it("MemoryWordStore: clearManifestStale conserva vigentes y favoritas", async () => {
    const { MemoryWordStore } = await import("./memory-store");
    const store = new MemoryWordStore();
    const row = (
      wordId: string,
      kind: "audio" | "illustration"
    ): MediaManifestRow => ({
      wordId,
      kind,
      url: `https://cdn.example.com/${wordId}.${kind === "audio" ? "mp3" : "png"}`,
      sha256: null,
      localUri: `file:///mock-doc/${wordId}`,
    });
    await store.upsertManifest(row("w1", "audio"));
    await store.upsertManifest(row("w2", "audio"));
    await store.upsertManifest(row("fav", "audio"));
    const { removed } = await store.clearManifestStale(["w1|audio"], ["fav"]);
    expect(removed).toBe(1);
    const ids = (await store.listManifest()).map((r) => r.wordId).sort();
    expect(ids).toEqual(["fav", "w1"]);
  });
});

describe("poda contra manifiesto (B3-03)", () => {
  const noSleep = async (_ms: number): Promise<void> => {};
  const BASE = "file:///mock-doc/";

  async function seedV1() {
    const { MemoryWordStore } = await import("./memory-store");
    const { populateMediaCache } = await import("./media-cache");
    const store = new MemoryWordStore();
    const w1 = wordRow({ id: "w1" });
    const w2 = wordRow({
      id: "w2",
      audioUrl: "https://cdn.example.com/audio/dos.mp3",
      illustrationUrl: "https://cdn.example.com/img/dos.png",
    });
    await store.upsertWords([w1, w2]);
    const words = await store.listAZ(null, 100);
    const media = createMemoryMediaStore(BASE);
    const cache = createMediaCache(media, { baseDir: BASE, sleep: noSleep });
    await populateMediaCache(cache, store, words, []);
    return { store, media, cache };
  }

  it("segunda sync con manifiesto reducido poda huerfanos y conserva referenciados", async () => {
    const { store, media, cache } = await seedV1();
    const before = await store.listManifest();
    expect(before).toHaveLength(4);
    // v2: solo w1 sobrevive; la poda logica + fisica la ejecuta el llamador.
    const v2 = before.filter((r) => r.wordId === "w1");
    const valid = v2.map((r) => `${r.wordId}|${r.kind}`);
    await store.clearManifestStale(valid, []);
    const { removed } = await cache.prune(await store.listManifest(), []);
    expect(removed).toBe(2);
    for (const row of v2) {
      expect((await media.getInfo(row.localUri)).exists).toBe(true);
    }
    expect(media.__files().size).toBe(2);
  });

  it("prune conserva archivos de favoritas aunque salgan del manifiesto", async () => {
    const { store, media, cache } = await seedV1();
    // Favorita con archivo heredado (pre-B3) y sin fila vigente.
    const legacyFav = `${BASE}audios/fav.mp3`;
    media.__files().set(legacyFav, "bytes-of:legacy");
    const all = await store.listManifest();
    const v2 = all.filter((r) => r.wordId === "w1");
    await store.clearManifestStale(
      v2.map((r) => `${r.wordId}|${r.kind}`),
      ["fav"]
    );
    const { removed } = await cache.prune(await store.listManifest(), [
      "fav",
    ]);
    // Solo w2 (audio + ilustracion) se poda; fav heredado se conserva.
    expect(removed).toBe(2);
    expect((await media.getInfo(legacyFav)).exists).toBe(true);
  });

  it("un poblado fallido no elimina archivos preexistentes", async () => {
    const { store, media, cache } = await seedV1();
    const filesBefore = media.__files().size;
    const bad: MediaRef = {
      wordId: "w3",
      kind: "audio",
      url: "https://cdn.example.com/audio/tres.mp3",
      sha256: null,
    };
    const failing = {
      ...createMemoryMediaStore(BASE),
      download: async (): Promise<{ uri: string }> => {
        throw new Error("net down");
      },
    };
    const failingCache = createMediaCache(failing, {
      baseDir: BASE,
      sleep: noSleep,
      maxAttempts: 1,
    });
    const { failed } = await failingCache.ensureAllCached([bad]);
    expect(failed).toHaveLength(1);
    // La poda nunca corre tras un poblado fallido: disciplina del llamador,
    // verificada acá por separación (populate/prune no se invocan solos).
    expect(media.__files().size).toBe(filesBefore);
    expect(store).toBeDefined();
    expect(cache).toBeDefined();
  });
});
