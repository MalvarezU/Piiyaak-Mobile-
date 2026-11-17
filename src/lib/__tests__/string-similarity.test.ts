import { describe, it, expect } from "vitest";
import { levenshtein, stringSimilarity } from "../string-similarity";

/**
 * Puerto exacto de `Diccionario nasa /src/lib/game-utils.ts`: las dos
 * plataformas deben coincidir en la métrica que elige distractores.
 */

describe("levenshtein", () => {
  it("cadenas iguales dan distancia 0", () => {
    expect(levenshtein("casa", "casa")).toBe(0);
  });

  it("una inserción cuesta 1", () => {
    expect(levenshtein("casa", "casas")).toBe(1);
  });

  it("una sustitución cuesta 1", () => {
    expect(levenshtein("casa", "cara")).toBe(1);
  });

  it("cadenas vacías devuelven el largo de la otra", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "")).toBe(0);
  });

  it("ignora mayúsculas y diacríticos (normalización NFD)", () => {
    expect(levenshtein("Águila", "aguila")).toBe(0);
    expect(levenshtein("mü", "mu")).toBe(0);
    expect(levenshtein("Ñandú", "nandu")).toBe(0);
  });

  it("corta y recorta espacios en los extremos", () => {
    expect(levenshtein("  casa ", "casa")).toBe(0);
  });

  it("cuenta la distancia completa entre palabras distintas", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("stringSimilarity", () => {
  it("idénticas dan 1", () => {
    expect(stringSimilarity("tsa", "tsa")).toBe(1);
  });

  it("ignora diacríticos: mü y mu dan 1", () => {
    expect(stringSimilarity("mü", "mu")).toBe(1);
  });

  it("devuelve un valor en [0, 1] para pares cualesquiera", () => {
    const pares: [string, string][] = [
      ["txhab", "txak"],
      ["kima", "kamen"],
      ["aaaa", "zzzz"],
      ["ab", "ba"],
    ];
    for (const [a, b] of pares) {
      const s = stringSimilarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("más parecido = más similar (orden consistente)", () => {
    // "tsa" es más parecido a "tsan" (1 cambio) que a "xyz" (3 cambios).
    expect(stringSimilarity("tsa", "tsan")).toBeGreaterThan(
      stringSimilarity("tsa", "xyz")
    );
  });

  it("cadenas vacías se consideran idénticas (1)", () => {
    expect(stringSimilarity("", "")).toBe(1);
  });
});
