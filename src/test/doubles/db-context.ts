import { jest } from "@jest/globals";
import { MemoryWordStore } from "../../db/memory-store";
import type { WordStore } from "../../db/sqlite-store";
import type { WordRow } from "../../db/types";

/**
 * Doble de `useDb()` para tests de pantallas.
 *
 * Las pantallas consumen `useDb()` de `src/db-context.tsx`, cuyo context no se
 * exporta. En vez de tocar producción, los tests mockean el módulo
 * `db-context` y delegan en este doble:
 *
 * ```tsx
 * jest.mock("../../db-context", () => require("../../test/doubles/db-context").dbContextDouble);
 * ```
 *
 * El store por defecto es `MemoryWordStore` (misma semántica que SQLite).
 */

export interface DbDouble {
  store: WordStore | null;
  courseStore: null;
  ready: boolean;
  syncing: boolean;
  syncProgress: { done: number; total: number } | null;
  lastSync: string | null;
  sync: jest.Mock<() => Promise<void>>;
  syncData: jest.Mock<() => Promise<void>>;
  favorites: string[];
  toggleFavorite: jest.Mock<(word: WordRow) => Promise<void>>;
  history: WordRow[];
  pushHistory: jest.Mock<(word: WordRow) => void>;
  pendingOutboxCount: number;
  seedState: null;
  retrySeed: jest.Mock<() => Promise<void>>;
  continueTextOnly: jest.Mock<() => void>;
  updateAvailable: null;
  dismissUpdate: jest.Mock<() => void>;
  acceptUpdate: jest.Mock<() => Promise<void>>;
}

/** Estado mutable que el test ajusta por caso. */
export let currentDb: DbDouble = createDbDouble();

export function createDbDouble(overrides: Partial<DbDouble> = {}): DbDouble {
  return {
    store: new MemoryWordStore(),
    courseStore: null,
    ready: true,
    syncing: false,
    syncProgress: null,
    lastSync: null,
    sync: jest.fn(async () => undefined),
    syncData: jest.fn(async () => undefined),
    favorites: [],
    toggleFavorite: jest.fn(async () => undefined),
    history: [],
    pushHistory: jest.fn(() => undefined),
    pendingOutboxCount: 0,
    seedState: null,
    retrySeed: jest.fn(async () => undefined),
    continueTextOnly: jest.fn(() => undefined),
    updateAvailable: null,
    dismissUpdate: jest.fn(() => undefined),
    acceptUpdate: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** Reemplaza el estado del doble (llamar en `beforeEach`). */
export function setDbDouble(overrides: Partial<DbDouble> = {}): DbDouble {
  currentDb = createDbDouble(overrides);
  return currentDb;
}

/** Módulo mockeable de `db-context` (la forma que consume `jest.mock`). */
export const dbContextDouble = {
  useDb: () => currentDb,
};
