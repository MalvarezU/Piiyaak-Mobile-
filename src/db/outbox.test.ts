import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import {
  flushOutbox,
  OUTBOX_MAX_PENDING,
  OUTBOX_PAYLOAD_MAX_BYTES,
  OutboxLimitError,
} from "./sync";
import type { SessionState } from "../api";

const session: SessionState = {
  cookie: "next-auth.session-token=abc",
  user: { id: "u1", email: "a@b.com", name: null, role: "user" },
};

function mockFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[i++] ?? responses[responses.length - 1]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("outbox & history", () => {
  it("round-trips outbox entries", async () => {
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }));
    const pending = await store.pendingOutbox();
    expect(pending.length).toBe(2);
    await store.markOutboxSynced(pending[0]!.id);
    const still = await store.pendingOutbox();
    expect(still.length).toBe(1);
  });

  it("persists and lists history", async () => {
    const store = new MemoryWordStore();
    await store.addHistory("w1", new Date().toISOString());
    await store.addHistory("w2", new Date(Date.now() + 1000).toISOString());
    const ids = await store.listHistory(10);
    expect(ids).toContain("w1");
    expect(ids).toContain("w2");
    expect(ids[0]).toBe("w2"); // most recent first
  });

  it("clears history", async () => {
    const store = new MemoryWordStore();
    await store.addHistory("w1", new Date().toISOString());
    await store.clearHistory();
    expect((await store.listHistory(10)).length).toBe(0);
  });
});

/**
 * B4-01 (CA7, R8): política de outbox — colapso por clave, límites y
 * FIFO con marca individual. RED primero: `OUTBOX_MAX_PENDING`,
 * `OUTBOX_PAYLOAD_MAX_BYTES`, `OutboxLimitError` y el colapso en
 * `flushOutbox` aún no existen.
 */
describe("outbox B4: colapso por clave (CA7)", () => {
  it("favoritas colapsan por clave (prevalece la última); historial/progreso íntegros", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { isFavorite: true } },
      { status: 200, body: {} },
    ]);
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }));
    await store.addOutbox("favorite", "favorite.remove", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox(
      "course_progress",
      "progress.set",
      JSON.stringify({ lessonId: "l1", completed: true })
    );

    await flushOutbox(store, session);

    // Favoritas de w1: un solo envío con la última operación (add).
    const favCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/dictionary/favorites")
    );
    expect(favCalls.length).toBe(1);
    expect(JSON.parse(String(favCalls[0]![1]?.body))).toEqual({ wordId: "w1" });
    // Historial y progreso se drenan íntegros (cada vista/completitud cuenta).
    const histCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/dictionary/history")
    );
    expect(histCalls.length).toBe(1);
    expect((await store.pendingOutbox()).length).toBe(0);
  });
});

describe("outbox B4: FIFO con marca individual (CA7)", () => {
  it("drena en orden ascendente; fallo o no-ok deja la entrada pendiente sin bloquear el resto", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { isFavorite: true } },
      { status: 500, body: {} },
      { status: 200, body: { isFavorite: true } },
    ]);
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }));
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w3" }));

    await flushOutbox(store, session);

    // Orden FIFO de envío: fav w1 → hist w2 → fav w3.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      expect.stringContaining("/api/dictionary/favorites"),
      expect.stringContaining("/api/dictionary/history"),
      expect.stringContaining("/api/dictionary/favorites"),
    ]);
    // Solo la entrada fallida sigue pendiente; el resto se marcó ante `ok`.
    const pending = await store.pendingOutbox();
    expect(pending.length).toBe(1);
    expect(JSON.parse(pending[0]!.payload)).toEqual({ wordId: "w2" });
  });

  it("flushOutbox(store, null) conserva su no-operación (acumula sin sesión)", async () => {
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await flushOutbox(store, null);
    expect((await store.pendingOutbox()).length).toBe(1);
  });
});

describe("outbox B4: límites en SQLiteWordStore (paridad)", () => {
  class FakeWordDb {
    readonly statements: string[] = [];
    pendingCount = 0;
    asDb(): never {
      return this as unknown as never;
    }
    async runAsync(sql: string): Promise<unknown> {
      this.statements.push(sql);
      return { lastInsertRowId: 1, changes: 1 };
    }
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      this.statements.push(sql);
      if (sql.includes("COUNT(*)")) return { n: this.pendingCount } as unknown as T;
      return null;
    }
    async getAllAsync(): Promise<never[]> {
      return [];
    }
    async execAsync(): Promise<void> {}
  }

  it("consulta el pendiente antes de insertar y rechaza al alcanzar el máximo", async () => {
    const { SQLiteWordStore } = await import("./sqlite-store");
    const fake = new FakeWordDb();
    const store = new SQLiteWordStore(
      fake.asDb() as unknown as import("expo-sqlite").SQLiteDatabase
    );
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w1" }));
    expect(fake.statements[0]).toMatch(/COUNT\(\*\)/);
    expect(fake.statements[1]).toMatch(/INSERT INTO outbox/);

    fake.pendingCount = OUTBOX_MAX_PENDING;
    await expect(
      store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }))
    ).rejects.toBeInstanceOf(OutboxLimitError);
    expect(fake.statements.filter((s) => s.startsWith("INSERT")).length).toBe(1);
  });

  it("rechaza payload excedido sin tocar la BD", async () => {
    const { SQLiteWordStore } = await import("./sqlite-store");
    const fake = new FakeWordDb();
    const store = new SQLiteWordStore(
      fake.asDb() as unknown as import("expo-sqlite").SQLiteDatabase
    );
    const big = JSON.stringify({ wordId: "w1", pad: "x".repeat(OUTBOX_PAYLOAD_MAX_BYTES) });
    await expect(store.addOutbox("history", "history.view", big)).rejects.toBeInstanceOf(
      OutboxLimitError
    );
    expect(fake.statements.length).toBe(0);
  });
});

describe("outbox B4: límites (CA7)", () => {
  it("expone OUTBOX_MAX_PENDING=500 y OUTBOX_PAYLOAD_MAX_BYTES=4096", () => {
    expect(OUTBOX_MAX_PENDING).toBe(500);
    expect(OUTBOX_PAYLOAD_MAX_BYTES).toBe(4096);
  });

  it("rechaza en addOutbox payloads que superen OUTBOX_PAYLOAD_MAX_BYTES", async () => {
    const store = new MemoryWordStore();
    const big = JSON.stringify({ wordId: "w1", pad: "x".repeat(OUTBOX_PAYLOAD_MAX_BYTES) });
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(OUTBOX_PAYLOAD_MAX_BYTES);
    await expect(store.addOutbox("history", "history.view", big)).rejects.toBeInstanceOf(
      OutboxLimitError
    );
    expect((await store.pendingOutbox()).length).toBe(0);
  });

  it("rechaza escrituras nuevas al superar OUTBOX_MAX_PENDING con error visible", async () => {
    const store = new MemoryWordStore();
    for (let i = 0; i < OUTBOX_MAX_PENDING; i++) {
      await store.addOutbox("history", "history.view", JSON.stringify({ wordId: `w${i}` }));
    }
    expect((await store.pendingOutbox()).length).toBe(OUTBOX_MAX_PENDING);
    const err = await store
      .addOutbox("history", "history.view", JSON.stringify({ wordId: "overflow" }))
      .then(
        () => null,
        (e: unknown) => e
      );
    expect(err).toBeInstanceOf(OutboxLimitError);
    // Mensaje visible al usuario: qué pasa y qué hacer.
    expect(String((err as Error).message)).toMatch(/inicie sesión/i);
  });
});