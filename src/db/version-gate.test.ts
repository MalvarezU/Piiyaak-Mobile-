import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryWordStore } from "./memory-store";
import {
  getRemoteVersion,
  getLocalVersion,
  setLocalVersion,
} from "./version-gate";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okVersion(contentVersion: string, serverTime: string) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ contentVersion, serverTime }),
  } as unknown as Response));
}

describe("getRemoteVersion", () => {
  it("hace GET /api/sync/version sin encabezado de autenticación con session null", async () => {
    const fetchMock = okVersion("42", "2026-11-01T00:00:00.000Z");
    vi.stubGlobal("fetch", fetchMock);
    const v = await getRemoteVersion(null);
    expect(v).toEqual({ contentVersion: "42", serverTime: "2026-11-01T00:00:00.000Z" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/sync/version");
    const headers = new Headers(init.headers);
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("acepta contentVersion numérico legacy y lo normaliza a string canónico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ contentVersion: 41, serverTime: "2026-11-01T00:00:00.000Z" }),
      } as unknown as Response))
    );
    const v = await getRemoteVersion(null);
    expect(v).toEqual({ contentVersion: "41", serverTime: "2026-11-01T00:00:00.000Z" });
    expect(typeof v.contentVersion).toBe("string");
  });

  it("acepta string canónico idéntico", async () => {
    vi.stubGlobal("fetch", okVersion("41", "2026-11-01T00:00:00.000Z"));
    const v = await getRemoteVersion(null);
    expect(v.contentVersion).toBe("41");
  });

  it("rechaza string vacío y número negativo", async () => {
    for (const bad of ["", -1]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ contentVersion: bad, serverTime: "2026-11-01T00:00:00.000Z" }),
        } as unknown as Response))
      );
      await expect(getRemoteVersion(null)).rejects.toThrow();
    }
  });
  it("rechaza respuesta inválida sin contentVersion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ serverTime: "2026-11-01T00:00:00.000Z" }),
      } as unknown as Response))
    );
    await expect(getRemoteVersion(null)).rejects.toThrow();
  });
});

describe("setLocalVersion / getLocalVersion", () => {
  it("escribe piiyaak:lastSync y piiyaak:contentVersion de forma conjunta", async () => {
    const store = new MemoryWordStore();
    await setLocalVersion(store, {
      contentVersion: "v42",
      serverTime: "2026-11-01T00:00:00.000Z",
    });
    expect(await store.getKV("piiyaak:contentVersion")).toBe("v42");
    expect(await store.getKV("piiyaak:lastSync")).toBe("2026-11-01T00:00:00.000Z");
    const local = await getLocalVersion(store);
    expect(local).toEqual({
      contentVersion: "v42",
      lastSync: "2026-11-01T00:00:00.000Z",
    });
  });

  it("retorna nulls cuando no hay versión local", async () => {
    const local = await getLocalVersion(new MemoryWordStore());
    expect(local).toEqual({ contentVersion: null, lastSync: null });
  });

  it("si una escritura falla, la sincronización se considera no confirmada", async () => {
    const store = new MemoryWordStore();
    vi.spyOn(store, "setKV").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      setLocalVersion(store, { contentVersion: "v9", serverTime: "2026-11-01T00:00:00.000Z" })
    ).rejects.toThrow("disk full");
  });
});
