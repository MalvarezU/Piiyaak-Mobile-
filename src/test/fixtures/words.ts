import type { WordRow } from "../../db/types";

/**
 * Fixtures de palabras para tests de UI.
 *
 * Datos deterministas y mínimos: el objetivo es que la pantalla reciba la
 * forma real de `WordRow`, no simular datos realistas de producción.
 */

export function makeWord(overrides: Partial<WordRow> = {}): WordRow {
  return {
    id: "w1",
    spanish: "casa",
    nasaYuwe: "tsa",
    pronunciation: null,
    audioUrl: null,
    illustrationUrl: null,
    culturalContext: null,
    category: "casa",
    examples: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export const WORDS: WordRow[] = [
  makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "casa" }),
  makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "naturaleza" }),
  makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "naturaleza" }),
];
