import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiFetch, loginRequest } from "./api";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("includes Cookie header when session provided", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const session = { cookie: "next-auth.session-token=abc", user: { id: "u", email: "a@b.com", name: null, role: "user" } };
    await apiFetch("/x", {}, session);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get("Cookie")).toBe("next-auth.session-token=abc");
  });

  it("aborts on timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const p = apiFetch("/x", {}, null, 50);
    vi.advanceTimersByTime(60);
    await expect(p).rejects.toThrow();
    vi.useRealTimers();
  });

  it("sets Content-Type for body", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("loginRequest", () => {
  it("returns null when csrf missing", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const res = await loginRequest("a@b.com", "pw");
    expect(res).toBeNull();
  });

  it("returns null on error location", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/auth/csrf")) {
        return { ok: true, status: 200, json: async () => ({ csrfToken: "t" }) } as unknown as Response;
      }
      return {
        ok: true,
        status: 302,
        headers: new Headers({ location: "/?error=CredentialsSignin", "set-cookie": "next-auth.session-token=abc; Path=/" }),
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await loginRequest("a@b.com", "pw");
    expect(res).toBeNull();
  });
});