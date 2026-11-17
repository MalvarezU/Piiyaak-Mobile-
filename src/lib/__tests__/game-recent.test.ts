import { describe, it, expect } from "vitest";
import { MemoryWordStore } from "../../db/memory-store";
import {
  RECENT_MAX,
  RECENT_KEY,
  getRecentWordIds,
  trackRecentWordIds,
} from "../game-recent";

/**
 * Buffer de rotación "games:recent" compartido por todos los juegos:
 * persistente en KV, más-reciente-primero, con tope y defensivo ante
 * datos corruptos. Un fallo de almacenamiento pierde variedad, nunca
 * funcionalidad.
 */

const store = () => new MemoryWordStore();

describe("getRecentWordIds / trackRecentWordIds", () => {
  it("round-trip: track guarda y get devuelve los ids en orden", async () => {
    const s = store();
    await trackRecentWordIds(s, ["a", "b", "c"]);
    expect(await getRecentWordIds(s)).toEqual(["a", "b", "c"]);
  });

  it("sin datos previos devuelve arreglo vacío", async () => {
    expect(await getRecentWordIds(store())).toEqual([]);
  });

  it("fusiona los nuevos al frente y deduplica conservando la primera aparición", async () => {
    const s = store();
    await trackRecentWordIds(s, ["a", "b"]);
    await trackRecentWordIds(s, ["c"]);
    expect(await getRecentWordIds(s)).toEqual(["c", "a", "b"]);

    // "b" ya estaba: su aparición previa se elimina y queda al frente.
    await trackRecentWordIds(s, ["b", "x"]);
    expect(await getRecentWordIds(s)).toEqual(["b", "x", "c", "a"]);
  });

  it("limita el buffer a RECENT_MAX entradas (las más recientes)", async () => {
    const s = store();
    const ids = Array.from({ length: RECENT_MAX + 10 }, (_, i) => `w${i}`);
    await trackRecentWordIds(s, ids);
    const recent = await getRecentWordIds(s);
    expect(recent).toHaveLength(RECENT_MAX);
    // Quedan las más recientes: los primeros del lote.
    expect(recent[0]).toBe("w0");
    expect(recent[RECENT_MAX - 1]).toBe(`w${RECENT_MAX - 1}`);
    expect(recent).not.toContain(`w${RECENT_MAX + 9}`);
  });

  it("tolera JSON corrupto y devuelve arreglo vacío", async () => {
    const s = store();
    await s.setKV(RECENT_KEY, "{no es json");
    expect(await getRecentWordIds(s)).toEqual([]);
  });

  it("tolera un valor no-arreglo y entradas no-string", async () => {
    const s = store();
    await s.setKV(RECENT_KEY, JSON.stringify("hola"));
    expect(await getRecentWordIds(s)).toEqual([]);

    await s.setKV(RECENT_KEY, JSON.stringify([1, "a", null, true, "b"]));
    expect(await getRecentWordIds(s)).toEqual(["a", "b"]);
  });

  it("traga el error si la escritura del KV falla", async () => {
    const s = store();
    s.setKV = async () => {
      throw new Error("KV lleno");
    };
    await expect(trackRecentWordIds(s, ["a"])).resolves.toBeUndefined();
    expect(await getRecentWordIds(s)).toEqual([]);
  });

  it("traga el error si la lectura del KV falla", async () => {
    const s = store();
    s.getKV = async () => {
      throw new Error("KV ilegible");
    };
    await expect(getRecentWordIds(s)).resolves.toEqual([]);
  });
});
