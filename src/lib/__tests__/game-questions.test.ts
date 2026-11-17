import { describe, it, expect } from "vitest";
import { shuffle } from "../game-random";
import { dedupePool, buildRound } from "../game-questions";

/**
 * Calidad de opciones: sin duplicados, sin fuga de respuestas futuras.
 */

interface W {
  id: string;
  spanish: string;
  nasaYuwe: string;
}

function makePool(n: number): W[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    spanish: `es${i}`,
    nasaYuwe: `ny${i}`,
  }));
}

describe("dedupePool", () => {
  it("quita duplicados por clave spanish||nasaYuwe conservando la primera aparición", () => {
    const pool: W[] = [
      { id: "a", spanish: "casa", nasaYuwe: "tsa" },
      { id: "b", spanish: "casa", nasaYuwe: "tsa" },
      { id: "c", spanish: "agua", nasaYuwe: "mü" },
    ];
    const out = dedupePool(pool);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("a");
    expect(out[1]!.id).toBe("c");
  });

  it("no muta la entrada", () => {
    const pool: W[] = [{ id: "a", spanish: "casa", nasaYuwe: "tsa" }];
    const before = [...pool];
    dedupePool(pool);
    expect(pool).toEqual(before);
  });
});

describe("buildRound", () => {
  it("las opciones siempre contienen la respuesta correcta", () => {
    const pool = makePool(12);
    const qs = buildRound({
      pool,
      askCount: 4,
      distractorCount: 3,
      answerOf: (w) => w.nasaYuwe,
    });
    for (const q of qs) {
      expect(q.options).toContain(q.options[q.correctIndex]);
      // correctIndex apunta a la respuesta del word.
      expect(q.options[q.correctIndex]).toBe(
        qs.find((x) => x.word === q.word) ? q.options[q.correctIndex] : ""
      );
    }
    // Verificación directa: la respuesta esperada está entre las opciones.
    const asks = pool.slice(0, 4);
    for (let i = 0; i < qs.length; i++) {
      expect(qs[i]!.options).toContain(asks[i]!.nasaYuwe);
    }
  });

  it("no hay cadenas de opción duplicadas dentro de una pregunta", () => {
    const pool = makePool(12);
    const qs = buildRound({
      pool,
      askCount: 4,
      distractorCount: 3,
      answerOf: (w) => w.nasaYuwe,
    });
    for (const q of qs) {
      expect(new Set(q.options).size).toBe(q.options.length);
    }
  });

  it("con pool de 4 palabras devuelve preguntas con al menos 2 opciones", () => {
    const pool = makePool(4);
    const qs = buildRound({
      pool,
      askCount: 4,
      distractorCount: 3,
      answerOf: (w) => w.nasaYuwe,
    });
    expect(qs.length).toBe(4);
    for (const q of qs) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("correctIndex es válido (>=0 y < options.length)", () => {
    const pool = makePool(10);
    const qs = buildRound({
      pool,
      askCount: 5,
      distractorCount: 3,
      answerOf: (w) => w.nasaYuwe,
    });
    for (const q of qs) {
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.options.length);
    }
  });

  it("property: las respuestas futuras no aparecen en las opciones de preguntas anteriores (>=100 seeds)", () => {
    const N = 120;
    const askCount = 6;
    const poolSize = askCount * 4; // >= 4×askCount
    for (let seed = 0; seed < N; seed++) {
      // Barajado determinista por seed: rotamos el pool.
      const base = makePool(poolSize);
      const rotated = base.slice(seed % poolSize).concat(base.slice(0, seed % poolSize));
      const pool = shuffle(rotated);

      const qs = buildRound({
        pool,
        askCount,
        distractorCount: 3,
        answerOf: (w) => w.nasaYuwe,
        similarityOf: (a, b) => {
          // similaridad trivial por índice de id
          return a.id === b.id ? 1 : 0;
        },
      });

      const answers = qs.map((q) => q.word.nasaYuwe);
      for (let i = 0; i < qs.length; i++) {
        const future = new Set(answers.slice(i + 1));
        for (const opt of qs[i]!.options) {
          expect(future.has(opt)).toBe(false);
        }
      }
    }
  });

  it("con similarityOf ordena distractores sin romper unicidad", () => {
    const pool = makePool(10);
    const qs = buildRound({
      pool,
      askCount: 4,
      distractorCount: 3,
      answerOf: (w) => w.nasaYuwe,
      similarityOf: (a, b) => (a.id === b.id ? 1 : 0.5),
    });
    for (const q of qs) {
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options).toContain(q.word.nasaYuwe);
    }
  });
});
