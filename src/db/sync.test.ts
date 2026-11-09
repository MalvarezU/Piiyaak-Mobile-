import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import { incrementalSync, fullSeed, syncNow, flushOutbox, AuthError } from "./sync";
import { syncCourses } from "./sync-courses";
import { MemoryCourseStore } from "./course-store";
import type { WordRow } from "./types";
import type { SessionState } from "../api";

const session: SessionState = {
  cookie: "next-auth.session-token=abc",
  user: { id: "u1", email: "a@b.com", name: null, role: "user" },
};

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  let i = 0;
  const fn = vi.fn(async () => {
    const r = (responses[i++] ?? responses[responses.length - 1])!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
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
  vi.useRealTimers();
});

describe("incrementalSync", () => {
  it("throws AuthError on 401", async () => {
    mockFetch([{ status: 401, body: {} }]);
    const store = new MemoryWordStore();
    await store.setLastSync(new Date().toISOString());
    await expect(incrementalSync(store, session)).rejects.toBeInstanceOf(AuthError);
  });

  it("retries on 500 and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    mockFetch([
      { status: 500, body: {} },
      { status: 200, body: { words: [], removedIds: [], serverTime: new Date().toISOString(), nextCursor: null } },
    ]);
    const store = new MemoryWordStore();
    await store.setLastSync(new Date().toISOString());
    const p = incrementalSync(store, session);
    await vi.runAllTimersAsync();
    const res = await p;
    expect(res.applied).toBe(0);
  });

  it("throws after 3 failed attempts", async () => {
    vi.useFakeTimers();
    mockFetch([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ]);
    const store = new MemoryWordStore();
    await store.setLastSync(new Date().toISOString());
    const p = incrementalSync(store, session);
    // attach catch to avoid unhandled rejection during timer flushing
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
  });

  it("applies words and removedIds", async () => {
    const now = new Date().toISOString();
    mockFetch([
      {
        status: 200,
        body: {
          words: [{ id: "w1", spanish: "hola", nasaYuwe: "h", pronunciation: null, audioUrl: null, illustrationUrl: null, culturalContext: null, category: null, examples: null, status: "PUBLISHED", updatedAt: now }],
          removedIds: ["w2"],
          serverTime: now,
          nextCursor: null,
        },
      },
    ]);
    const store = new MemoryWordStore();
    await store.upsertWords([{ id: "w2", spanish: "x", nasaYuwe: "y", pronunciation: null, audioUrl: null, illustrationUrl: null, culturalContext: null, category: null, examples: null, updatedAt: now }]);
    await store.setLastSync(new Date(0).toISOString());
    const res = await incrementalSync(store, session);
    expect(res.applied).toBe(1);
    expect(res.removed).toBe(1);
    expect(await store.getById("w1")).not.toBeNull();
    expect(await store.getById("w2")).toBeNull();
  });
});

describe("fullSeed", () => {
  it("applies all pages and sets lastSync", async () => {
    const now = new Date().toISOString();
    mockFetch([
      { status: 200, body: { words: [{ id: "w1", spanish: "a", nasaYuwe: "b", pronunciation: null, audioUrl: null, illustrationUrl: null, culturalContext: null, category: null, examples: null, status: "PUBLISHED", updatedAt: now }], total: 1, totalPages: 1, serverTime: now } },
    ]);
    const store = new MemoryWordStore();
    const res = await fullSeed(store, session, () => {});
    expect(res.applied).toBe(1);
    expect(await store.getLastSync()).toBe(now);
  });
});

describe("syncNow", () => {
  it("calls fullSeed when no data", async () => {
    const now = new Date().toISOString();
    mockFetch([
      { status: 200, body: { contentVersion: "v1", serverTime: now } },
      { status: 200, body: { words: [], total: 0, totalPages: 0, serverTime: now } },
    ]);
    const store = new MemoryWordStore();
    await syncNow(store, session);
    expect(await store.getLastSync()).toBe(now);
  });
});

describe("syncNow gate de versión (B1)", () => {
  const NOW = "2026-11-09T00:00:00.000Z";
  const word = (id: string): WordRow => ({
    id,
    spanish: `es-${id}`,
    nasaYuwe: `ny-${id}`,
    pronunciation: null,
    audioUrl: null,
    illustrationUrl: null,
    culturalContext: null,
    category: null,
    examples: null,
    status: "PUBLISHED",
    updatedAt: NOW,
  });

  /** fetch mock con ruteo por URL; registra todas las llamadas. */
  function mockGateRoutes(opts: {
    version: { contentVersion: string; serverTime: string } | { reject: Error } | { invalid: unknown };
    seedPages?: Array<{ words: WordRow[]; total: number; totalPages: number; serverTime: string }>;
    deltas?: Array<{ words: WordRow[]; removedIds: string[]; serverTime: string; nextCursor: string | null }>;
  }) {
    const calls: string[] = [];
    const seedPages = [...(opts.seedPages ?? [])];
    const deltas = [...(opts.deltas ?? [])];
    const mock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("/api/sync/version")) {
        if ("reject" in opts.version) throw (opts.version as { reject: Error }).reject;
        if ("invalid" in opts.version) {
          const body = (opts.version as { invalid: unknown }).invalid;
          return { ok: true, status: 200, json: async () => body } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => opts.version } as unknown as Response;
      }
      if (url.includes("/api/sync/seed")) {
        const page = seedPages.shift() ?? { words: [], total: 0, totalPages: 0, serverTime: NOW };
        return { ok: true, status: 200, json: async () => page } as unknown as Response;
      }
      if (url.includes("/api/sync")) {
        const d = deltas.shift() ?? { words: [], removedIds: [], serverTime: NOW, nextCursor: null };
        return { ok: true, status: 200, json: async () => d } as unknown as Response;
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", mock);
    return { mock, calls };
  }

  async function seededStore(contentVersion: string | null, lastSync: string | null) {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w0")]);
    if (lastSync) await store.setLastSync(lastSync);
    if (contentVersion) await store.setKV("piiyaak:contentVersion", contentVersion);
    return store;
  }

  it("versión igual omite /api/sync y /api/sync/seed", async () => {
    const store = await seededStore("v1", NOW);
    const { calls } = mockGateRoutes({ version: { contentVersion: "v1", serverTime: NOW } });
    const res = await syncNow(store, null);
    expect(res).toMatchObject({ applied: 0, removed: 0, hasMore: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/sync/version");
  });

  it("versión distinta sincroniza y actualiza ambas claves", async () => {
    const store = await seededStore("v1", "2026-01-01T00:00:00.000Z");
    const T2 = "2026-11-09T12:00:00.000Z";
    const { calls } = mockGateRoutes({
      version: { contentVersion: "v2", serverTime: T2 },
      deltas: [{ words: [word("w1")], removedIds: [], serverTime: T2, nextCursor: null }],
    });
    const res = await syncNow(store, null);
    expect(res.applied).toBe(1);
    expect(calls.some((u) => u.includes("/api/sync?"))).toBe(true);
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v2");
    expect(await store.getLastSync()).toBe(T2);
    expect(await store.getById("w1")).not.toBeNull();
  });

  it("versión remota menor también sincroniza y adopta la remota (borde 6.1)", async () => {
    const store = await seededStore("v2", NOW);
    mockGateRoutes({
      version: { contentVersion: "v1", serverTime: NOW },
      deltas: [{ words: [], removedIds: [], serverTime: NOW, nextCursor: null }],
    });
    await syncNow(store, null);
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v1");
  });

  it("instalación sin contentVersion hace sync completa reutilizando lastSync como cursor", async () => {
    const T0 = "2026-10-01T00:00:00.000Z";
    const store = await seededStore(null, T0);
    const { calls } = mockGateRoutes({
      version: { contentVersion: "v5", serverTime: NOW },
      deltas: [{ words: [word("w9")], removedIds: [], serverTime: NOW, nextCursor: null }],
    });
    const res = await syncNow(store, null);
    expect(res.applied).toBe(1);
    // Rama incremental (reutiliza since), no seed redundante:
    expect(calls.some((u) => u.includes("/api/sync/seed"))).toBe(false);
    expect(calls.some((u) => u.includes("/api/sync?") && u.includes(encodeURIComponent(T0).slice(0, 8)))).toBe(true);
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v5");
    expect(await store.getById("w9")).not.toBeNull();
  });

  it("sin datos ni lastSync hace fullSeed y adopta el gate", async () => {
    const store = new MemoryWordStore();
    const { calls } = mockGateRoutes({
      version: { contentVersion: "v1", serverTime: NOW },
      seedPages: [{ words: [word("s1")], total: 1, totalPages: 1, serverTime: NOW }],
    });
    const res = await syncNow(store, null);
    expect(res.applied).toBe(1);
    expect(calls.some((u) => u.includes("/api/sync/seed"))).toBe(true);
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v1");
    expect(await store.getLastSync()).toBe(NOW);
  });
});

describe("arranque offline (B1)", () => {
  const NOW = "2026-11-09T00:00:00.000Z";
  const word = (id: string, spanish: string): WordRow => ({
    id,
    spanish,
    nasaYuwe: `ny-${id}`,
    pronunciation: null,
    audioUrl: null,
    illustrationUrl: null,
    culturalContext: null,
    category: "frutas",
    examples: null,
    status: "PUBLISHED",
    updatedAt: NOW,
  });

  it("arranque offline con fetch bloqueado resuelve bundle sin red de sync", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w1", "mango"), word("w2", "piña")]);
    await store.setLastSync(NOW);
    await store.setKV("piiyaak:contentVersion", "v7");
    const fetchMock = vi.fn(async (_url: string) => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    // Gate intenta versión, falla, y resuelve local sin lanzar:
    const res = await syncNow(store, null);
    expect(res).toMatchObject({ applied: 0, removed: 0 });
    const calls = fetchMock.mock.calls.map((c) => String(c[0]!));
    expect(calls.some((u) => u.includes("/api/sync/seed") || u.includes("/api/sync?"))).toBe(false);
    // El bundle sirve lectura local:
    expect((await store.search("man")).map((w) => w.id)).toEqual(["w1"]);
    expect((await store.listAZ()).length).toBe(2);
    expect(await store.listCategories()).toEqual(["frutas"]);
  });

  it("bundle con lastSync sin prefijo dispara sync (regresión R3)", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w1", "mango")]);
    // Siembra heredada con clave sin prefijo: el gate no la reconoce.
    await store.setKV("lastSync", NOW);
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        if (url.includes("/api/sync/version")) {
          return { ok: true, status: 200, json: async () => ({ contentVersion: "v9", serverTime: NOW }) } as unknown as Response;
        }
        if (url.includes("/api/sync/seed")) {
          return { ok: true, status: 200, json: async () => ({ words: [], total: 0, totalPages: 0, serverTime: NOW }) } as unknown as Response;
        }
        return { ok: true, status: 200, json: async () => ({ words: [], removedIds: [], serverTime: NOW, nextCursor: null }) } as unknown as Response;
      })
    );
    await syncNow(store, null);
    // El gate no ve ni contentVersion ni lastSync con prefijo → sincroniza.
    expect(seen.some((u) => u.includes("/api/sync/seed") || u.includes("/api/sync?"))).toBe(true);
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v9");
  });
});

describe("lectura sin sesión (B1)", () => {
  const NOW = "2026-11-09T00:00:00.000Z";

  function headerOf(call: unknown): Headers {
    const [, init] = call as [string, RequestInit];
    return new Headers(init?.headers);
  }

  it("incremental con authToken null completa sin encabezados de auth", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/sync/version")) {
        return { ok: true, status: 200, json: async () => ({ contentVersion: "v1", serverTime: NOW }) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ words: [], removedIds: [], serverTime: NOW, nextCursor: null }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new MemoryWordStore();
    await store.upsertWords([{
      id: "w1", spanish: "a", nasaYuwe: "b", pronunciation: null, audioUrl: null,
      illustrationUrl: null, culturalContext: null, category: null, examples: null,
      status: "PUBLISHED", updatedAt: NOW,
    }]);
    await store.setLastSync("2026-01-01T00:00:00.000Z");
    const res = await incrementalSync(store, null);
    expect(res).toMatchObject({ applied: 0, removed: 0 });
    expect(fetchMock).toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      const h = headerOf(call);
      expect(h.get("Cookie")).toBeNull();
      expect(h.get("Authorization")).toBeNull();
    }
  });

  it("syncCourses con authToken null no envía Authorization y completa", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            courses: [{ id: "c1", title: "Curso", description: null, status: "PUBLISHED", coverImage: null, modules: 1, lessons: 1, progressPct: null }],
          }),
        } as unknown as Response;
      }
      return {
        ok: true, status: 200,
        json: async () => ({
          course: { modules: [{ id: "m1", title: "M1", order: 0, lessons: [{ id: "l1", title: "L1", order: 0, lessonNumber: 1, content: {} }] }] },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new MemoryCourseStore();
    const res = await syncCourses(store, null);
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 1 });
    expect(fetchMock).toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      const h = headerOf(call);
      expect(h.get("Cookie")).toBeNull();
      expect(h.get("Authorization")).toBeNull();
    }
    expect(await store.getCourse("c1")).not.toBeNull();
  });

  it("flushOutbox conserva su guarda sin sesión (no-regresión)", async () => {
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await flushOutbox(store, null);
    expect((await store.pendingOutbox()).length).toBe(1);
  });
});

describe("flushOutbox", () => {
  it("does nothing without session", async () => {
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await flushOutbox(store, null);
    expect((await store.pendingOutbox()).length).toBe(1);
  });

  it("marks synced on success", async () => {
    mockFetch([{ status: 200, body: { isFavorite: true } }]);
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await flushOutbox(store, session);
    expect((await store.pendingOutbox()).length).toBe(0);
  });
});