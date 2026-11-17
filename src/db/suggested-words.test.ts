import { describe, it, expect, beforeEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import { loadSuggestedWords, hashDateKey } from "./suggested-words";
import type { WordRow } from "./types";

const NOW = "2026-11-09T00:00:00.000Z";

const word = (id: string, illustrated = false, status = "PUBLISHED"): WordRow => ({
  id,
  spanish: `es-${id}`,
  nasaYuwe: `ny-${id}`,
  pronunciation: null,
  audioUrl: null,
  illustrationUrl: illustrated ? `https://img/${id}` : null,
  culturalContext: null,
  category: null,
  examples: null,
  status,
  updatedAt: NOW,
});

describe("hashDateKey", () => {
  it("is stable and unsigned 32-bit", () => {
    const h = hashDateKey("2026-06-01");
    expect(h).toBe(hashDateKey("2026-06-01"));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe("loadSuggestedWords", () => {
  let store: MemoryWordStore;

  beforeEach(() => {
    store = new MemoryWordStore();
  });

  it("store vacío → []", async () => {
    const res = await loadSuggestedWords(store, "2026-11-09", null);
    expect(res).toEqual([]);
  });

  it("prefiere ilustradas cuando hay >=5", async () => {
    const words = [
      ...Array.from({ length: 7 }, (_, i) => word(`i${i}`, true)),
      ...Array.from({ length: 3 }, (_, i) => word(`n${i}`, false)),
    ];
    await store.upsertWords(words);
    const res = await loadSuggestedWords(store, "2026-03-15", null);
    expect(res).toHaveLength(5);
    expect(res.every((w) => !!w.illustrationUrl)).toBe(true);
  });

  it("completa con no-ilustradas cuando hay <5 ilustradas", async () => {
    await store.upsertWords([
      word("i0", true),
      word("i1", true),
      ...Array.from({ length: 5 }, (_, i) => word(`n${i}`, false)),
    ]);
    const res = await loadSuggestedWords(store, "2026-03-15", null);
    expect(res).toHaveLength(5);
    const ill = res.filter((w) => !!w.illustrationUrl).length;
    expect(ill).toBe(2);
  });

  it("cache hit: devuelve cacheadas sin recalcular", async () => {
    await store.upsertWords([word("a", true), word("b", true)]);
    // Forzar cache con ids que resuelven.
    await store.upsertWords([word("x", true), word("y", true), word("z", true), word("p", true), word("q", true)]);
    const ids = ["x", "y", "z", "p", "q"];
    await store.setKV("suggestedDate", "2026-11-09");
    await store.setKV("suggestedIds", JSON.stringify(ids));

    const res = await loadSuggestedWords(store, "2026-11-09", null);
    expect(res.map((w) => w.id)).toEqual(ids);
  });

  it("recalcula cuando la fecha es distinta", async () => {
    await store.upsertWords(Array.from({ length: 6 }, (_, i) => word(`i${i}`, true)));
    await store.setKV("suggestedDate", "2026-11-08");
    await store.setKV("suggestedIds", JSON.stringify(["i0"]));

    const res = await loadSuggestedWords(store, "2026-11-09", null);
    expect(res).toHaveLength(5);
    expect(await store.getKV("suggestedDate")).toBe("2026-11-09");
    const cached = JSON.parse((await store.getKV("suggestedIds")) as string);
    expect(cached).toHaveLength(5);
  });

  it("paridad de orden por id (illustrated sort asc antes de ventana)", async () => {
    // 7 ilustradas con ids no ordenados de entrada.
    const ids = ["z", "a", "m", "b", "c", "d", "e"];
    await store.upsertWords(ids.map((id) => word(id, true)));
    const res = await loadSuggestedWords(store, "2026-06-01", null);
    // Reproducir algoritmo esperado.
    const illustrated = ids
      .map((id) => word(id, true))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const n = illustrated.length;
    const offset = hashDateKey("2026-06-01") % n;
    const expected: string[] = [];
    const set = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const id = illustrated[(offset + i) % n]!.id;
      if (!set.has(id)) {
        expected.push(id);
        set.add(id);
      }
    }
    expect(res.map((w) => w.id)).toEqual(expected);
  });

  it("no registra historial", async () => {
    await store.upsertWords([word("i0", true)]);
    // total <5 pero al menos 1
    await loadSuggestedWords(store, "2026-11-09", null);
    expect(await store.listHistory(10)).toEqual([]);
    expect(await store.pendingOutbox()).toEqual([]);
  });
});
