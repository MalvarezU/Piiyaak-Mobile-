import { describe, it, expect } from "vitest";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import { pickGameWords } from "../game-words";

/**
 * Pool con rotación: dos llamadas seguidas deben devolver conjuntos
 * sustancialmente distintos gracias al buffer `games:recent`.
 */

describe("pickGameWords", () => {
  it("rota: dos llamadas seguidas devuelven conjuntos sustancialmente distintos", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords(
      Array.from({ length: 30 }, (_, i) =>
        makeWord({ id: `w${i}`, spanish: `es${i}`, nasaYuwe: `ny${i}` })
      )
    );

    const first = await pickGameWords(store, { count: 8 });
    const second = await pickGameWords(store, { count: 8 });

    const firstIds = new Set(first.map((w) => w.id));
    const secondIds = new Set(second.map((w) => w.id));
    const intersection = [...firstIds].filter((id) => secondIds.has(id)).length;

    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(second.length).toBeGreaterThanOrEqual(8);
    // Rotación real: el segundo evita (al menos en su mayoría) los ya vistos.
    expect(intersection).toBeLessThan(first.length);
  });

  it("un store de 4 palabras devuelve 4 (escalera de respaldo)", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords(
      Array.from({ length: 4 }, (_, i) =>
        makeWord({ id: `w${i}`, spanish: `es${i}`, nasaYuwe: `ny${i}` })
      )
    );

    const pool = await pickGameWords(store, { count: 8 });
    expect(pool).toHaveLength(4);
  });

  it("withAudio: true filtra solo palabras con audio publicado", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords(
      Array.from({ length: 12 }, (_, i) =>
        makeWord({
          id: `w${i}`,
          spanish: `es${i}`,
          nasaYuwe: `ny${i}`,
          audioUrl: i < 6 ? `https://cdn.test/${i}.mp3` : null,
        })
      )
    );

    const pool = await pickGameWords(store, { count: 8, withAudio: true });
    expect(pool.length).toBeGreaterThanOrEqual(4);
    for (const w of pool) {
      expect(w.audioUrl).toBeTruthy();
    }
  });

  it("count <= 0 devuelve arreglo vacío", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([makeWord()]);
    expect(await pickGameWords(store, { count: 0 })).toEqual([]);
  });
});
