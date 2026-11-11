import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import { fullSeed, incrementalSync } from "./sync";
import type { WordRow } from "./types";

const w = (id: string, spanish: string, extra?: Partial<WordRow>): WordRow => ({
  id,
  spanish,
  nasaYuwe: `ny-${id}`,
  pronunciation: null,
  audioUrl: null,
  illustrationUrl: null,
  culturalContext: null,
  category: null,
  examples: null,
  updatedAt: new Date().toISOString(),
  ...extra,
});

describe("MemoryWordStore [app]", () => {
  it("busca con ranking exacta > prefijo > parcial e ignora tildes", async () => {
    const s = new MemoryWordStore();
    await s.upsertWords([w("1", "pájaro"), w("2", "palo"), w("3", "capa")]);
    expect((await s.search("palo")).map((x) => x.id)).toEqual(["2"]);
    expect((await s.search("pa")).map((x) => x.id).sort()).toEqual(["1", "2", "3"]);
    expect((await s.search("pajaro")).map((x) => x.id)).toEqual(["1"]);
    expect(await s.search("x")).toEqual([]);
    expect(await s.search("a")).toEqual([]);
    expect(await s.getById("2")).toMatchObject({ spanish: "palo" });
    await s.removeWords(["2"]);
    expect(await s.count()).toBe(2);
  });

  it("listWithAudio: query directa por audioUrl, sin depender del corte alfabético", async () => {
    const s = new MemoryWordStore();
    await s.upsertWords([
      w("a1", "abeja", { audioUrl: "https://r2.example/audios/abeja.ogg" }),
      w("z1", "zorro", { audioUrl: "https://r2.example/audios/zorro.ogg" }),
      w("m1", "mesa"),
      w("d1", "dado", { audioUrl: "" }), // vacío = sin audio
    ]);
    // zorro ordena al final del alfabeto: con el corte alfabético del
    // listAZ quedaría fuera; la query directa lo trae igual.
    expect((await s.listWithAudio(200)).map((r) => r.id)).toEqual(["a1", "z1"]);
    expect((await s.listWithAudio(1)).map((r) => r.id)).toEqual(["a1"]);
  });
});

describe("sync [app]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("seed pagina hasta agotar y guarda lastSync", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ words: [w("1", "a")], total: 2, totalPages: 2, serverTime: "T1" })
      )
      .mockResolvedValueOnce(
        Response.json({ words: [w("2", "b")], total: 2, totalPages: 2, serverTime: "T2" })
      );
    const store = new MemoryWordStore();
    const r = await fullSeed(store, null);
    expect(r).toMatchObject({ applied: 2, serverTime: "T2" });
    expect(await store.count()).toBe(2);
    expect(await store.getLastSync()).toBe("T2");
  });

  it("incremental aplica deltas y borrados y sigue cursor", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([w("1", "a"), w("9", "z")]);
    await store.setLastSync("2026-09-01T00:00:00.000Z");
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          words: [w("2", "b")],
          removedIds: ["w9-missing", "9"],
          serverTime: "T3",
          nextCursor: "cursor-1",
        })
      )
      .mockResolvedValueOnce(
        Response.json({ words: [], removedIds: [], serverTime: "T4", nextCursor: null })
      );
    const r = await incrementalSync(store, null);
    expect(r).toMatchObject({ applied: 1, removed: 2, serverTime: "T4" });
    expect(await store.getById("2")).not.toBeNull();
    expect(await store.getById("9")).toBeNull();
    expect(await store.getLastSync()).toBe("T4");
  });

  it("lanza error si el servidor falla", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("x", { status: 500 }));
    await expect(fullSeed(new MemoryWordStore(), null)).rejects.toThrow();
  });
});

describe("MemoryWordStore draft filtering [app]", () => {
  it("excluye DRAFT de search/listAZ pero getById lo devuelve", async () => {
    const s = new MemoryWordStore();
    await s.upsertWords([
      w("1", "hola"),
      w("2", "borrador", { status: "DRAFT" }),
    ]);
    expect((await s.search("ho")).map((x) => x.id)).toEqual(["1"]);
    expect((await s.listAZ()).map((x) => x.id)).toEqual(["1"]);
    expect(await s.getById("2")).toMatchObject({ status: "DRAFT" });
  });

  it("persiste illustrationUrl", async () => {
    const s = new MemoryWordStore();
    await s.upsertWords([w("1", "hola", { illustrationUrl: "https://x/img.png" })]);
    expect((await s.getById("1"))?.illustrationUrl).toBe("https://x/img.png");
  });
});
