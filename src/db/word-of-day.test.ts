import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import {
  fetchWordOfDay,
  loadWordOfDay,
  recordWordOfDayLocalView,
} from "./word-of-day";
import type { SessionState } from "../api";
import type { WordRow } from "./types";

const NOW = "2026-11-09T00:00:00.000Z";
const session: SessionState = {
  cookie: "next-auth.session-token=abc",
  user: { id: "u1", email: "a@b.com", name: null, role: "user" },
};

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

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWordOfDay", () => {
  it("sin sesión retorna wordId sin exigir autenticación", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/dictionary/word-of-day?date=2026-11-09");
      return { ok: true, status: 200, json: async () => ({ word: { id: "w1" } }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWordOfDay("2026-11-09", null);
    expect(res).toEqual({ wordId: "w1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("con sesión envía autenticación (no-regresión)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ word: { id: "w1" } }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchWordOfDay("2026-11-09", session);
    expect(res).toEqual({ wordId: "w1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Cookie")).toBe(session.cookie);
  });

  it("respuesta sin palabra retorna null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ word: null }) } as unknown as Response))
    );
    expect(await fetchWordOfDay("2026-11-09", null)).toBeNull();
  });
});

describe("loadWordOfDay", () => {
  it("sin sesión resuelve contenido local sin escribir historial remoto", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w1")]);
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true, status: 200, json: async () => ({ word: { id: "w1" } }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const w = await loadWordOfDay(store, "2026-11-09", null);
    expect(w?.id).toBe("w1");
    // Sin llamadas a historial de servidor:
    const urls = fetchMock.mock.calls.map((c) => String(c[0]!));
    expect(urls.some((u) => u.includes("/api/dictionary/history"))).toBe(false);
    // Historial únicamente local + outbox:
    expect(await store.listHistory(10)).toContain("w1");
    expect((await store.pendingOutbox()).length).toBe(1);
    // Caché por fecha actualizada:
    expect(await store.getKV("wodDate")).toBe("2026-11-09");
    expect(await store.getKV("wodId")).toBe("w1");
  });

  it("con sesión resuelve sin contaminar outbox local (historial servidor vía ficha)", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w1")]);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ word: { id: "w1" } }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const w = await loadWordOfDay(store, "2026-11-09", session);
    expect(w?.id).toBe("w1");
    expect((await store.pendingOutbox()).length).toBe(0);
    // Ruta autenticada: la lectura lleva Cookie (el servidor atribuye la
    // vista y ficha la registra vía pushHistory; nada queda en outbox).
    const wodCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/dictionary/word-of-day")
    );
    expect(wodCall).toBeDefined();
    expect(
      (wodCall![1]?.headers as unknown as Headers).get?.("Cookie") ??
        (wodCall![1]?.headers as Record<string, string>)["Cookie"]
    ).toBe(session.cookie);
  });

  it("offline con caché vigente devuelve la palabra cacheada", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([word("w7")]);
    await store.setKV("wodDate", "2026-11-09");
    await store.setKV("wodId", "w7");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const w = await loadWordOfDay(store, "2026-11-09", null);
    expect(w?.id).toBe("w7");
  });
});

describe("recordWordOfDayLocalView", () => {
  it("registra historial local + outbox", async () => {
    const store = new MemoryWordStore();
    await recordWordOfDayLocalView(store, "w3");
    expect(await store.listHistory(10)).toContain("w3");
    const pending = await store.pendingOutbox();
    expect(pending.length).toBe(1);
    expect(JSON.parse(pending[0]!.payload)).toEqual({ wordId: "w3" });
  });
});
