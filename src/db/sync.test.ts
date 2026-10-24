import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import { incrementalSync, fullSeed, syncNow, flushOutbox, AuthError } from "./sync";
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
    mockFetch([{ status: 200, body: { words: [], total: 0, totalPages: 0, serverTime: now } }]);
    const store = new MemoryWordStore();
    await syncNow(store, session);
    expect(await store.getLastSync()).toBe(now);
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