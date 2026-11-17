import { describe, it, expect, vi, afterEach } from "vitest";
import { shuffle, sampleRandom } from "../game-random";

/**
 * Utilidades aleatorias compartidas por los juegos. Espejo del
 * `game-utils.ts` de la web: Fisher-Yates sobre copia, sin mutar la entrada.
 */

describe("shuffle", () => {
  it("devuelve los mismos elementos en otro orden", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(items);
    expect([...out].sort((a, b) => a - b)).toEqual(items);
  });

  it("no muta el arreglo de entrada", () => {
    const items = [3, 1, 2];
    const antes = [...items];
    shuffle(items);
    expect(items).toEqual(antes);
  });

  it("funciona con arreglo vacío y con un solo elemento", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(["único"])).toEqual(["único"]);
  });

  it("baraja arreglos grandes sin perder elementos ni duplicar", () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const out = shuffle(items);
    expect(out).toHaveLength(1000);
    expect(new Set(out).size).toBe(1000);
  });

  it("con Math.random fijo en 0.999999 el orden es la identidad", () => {
    // Contrato compartido con los tests de pantalla (jest): con el mock
    // `0.999999`, `floor(0.999999 * (i+1)) == i` y el Fisher-Yates no toca
    // nada. La web y el móvil deben comportarse igual.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      const items = [1, 2, 3, 4, 5];
      expect(shuffle(items)).toEqual([1, 2, 3, 4, 5]);
    } finally {
      spy.mockRestore();
    }
  });

  it("no deja el primer elemento siempre igual en muchas corridas", () => {
    // Sanidad de distribución: con 100 barajados de 3 elementos, que el
    // primero sea siempre el mismo tiene probabilidad (1/3)^100 ≈ 0.
    const primeros = new Set<number>();
    for (let run = 0; run < 100; run++) {
      primeros.add(shuffle([1, 2, 3])[0]!);
    }
    expect(primeros.size).toBeGreaterThan(1);
  });
});

describe("sampleRandom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("count <= 0 o no finito devuelve arreglo vacío", () => {
    expect(sampleRandom([1, 2, 3], 0)).toEqual([]);
    expect(sampleRandom([1, 2, 3], -5)).toEqual([]);
    expect(sampleRandom([1, 2, 3], Number.NaN)).toEqual([]);
  });

  it("count > length devuelve todo el arreglo barajado", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      expect(sampleRandom([1, 2, 3], 10)).toEqual([1, 2, 3]);
    } finally {
      spy.mockRestore();
    }
  });

  it("respeta el tope, sin repetidos y solo elementos del input", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    for (let run = 0; run < 50; run++) {
      const out = sampleRandom(items, 10);
      expect(out).toHaveLength(10);
      expect(new Set(out).size).toBe(10);
      for (const v of out) expect(items).toContain(v);
    }
  });

  it("no muta el arreglo de entrada", () => {
    const items = [1, 2, 3];
    const antes = [...items];
    sampleRandom(items, 2);
    expect(items).toEqual(antes);
  });
});
