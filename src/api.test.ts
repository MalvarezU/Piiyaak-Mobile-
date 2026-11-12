import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiFetch,
  loginRequest,
  registerRequest,
  recoverRequest,
  resetRequest,
  toAbsoluteUrl,
  API_BASE_URL,
  REGISTRATION_DISABLED_MESSAGE,
} from "./api";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Respuesta mínima con cuerpo JSON. */
function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => body,
  } as unknown as Response;
}

describe("toAbsoluteUrl", () => {
  it("resuelve una ruta relativa contra la URL base de la API", () => {
    expect(toAbsoluteUrl("/audio/x.mp3")).toBe(`${API_BASE_URL}/audio/x.mp3`);
  });

  it("deja intacta una URL absoluta", () => {
    expect(toAbsoluteUrl("https://cdn.example.com/ybc.jpg")).toBe(
      "https://cdn.example.com/ybc.jpg"
    );
  });
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

  it("devuelve la respuesta de error sin lanzar (el llamador decide)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 400 })));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });

  it.each([401, 404])("propaga el estado %i tal cual", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status })));
    const res = await apiFetch("/api/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(status);
  });

  it("propaga el error de red cuando fetch falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(apiFetch("/api/x")).rejects.toThrow("fetch failed");
  });

  it("deja propagar el error de parseo de un cuerpo no-JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
          }) as unknown as Response
      )
    );
    const res = await apiFetch("/api/x");
    await expect(res.json()).rejects.toThrow("Unexpected token");
  });

  it("no manda cabecera de autenticación sin sesión", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Cookie")).toBeNull();
  });

  it("conserva las cabeceras del llamador y respeta su Content-Type", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x", {
      method: "POST",
      body: "texto-plano",
      headers: { "Content-Type": "text/plain", "X-Marca": "1" },
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect(headers.get("X-Marca")).toBe("1");
  });

  it("no setea Content-Type cuando la petición no lleva cuerpo", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x", { method: "GET" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });

  it("limpia el temporizador de timeout al terminar la petición", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    await apiFetch("/api/x");
    expect(vi.getTimerCount()).toBe(0);
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

  /** Mock del flujo completo: csrf → callback → session. */
  function mockLoginFlow(opts: {
    csrfOk?: boolean;
    omitCsrfToken?: boolean;
    omitLocation?: boolean;
    setCookie?: string | null;
    location?: string;
    sessionStatus?: number;
    user?: unknown;
  }) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/auth/csrf")) {
        return jsonResponse(
          opts.omitCsrfToken ? {} : { csrfToken: "t" },
          { ok: opts.csrfOk ?? true, status: opts.csrfOk === false ? 401 : 200 }
        );
      }
      if (url.includes("/api/auth/callback/credentials")) {
        const headers: Record<string, string> = opts.omitLocation
          ? {}
          : { location: opts.location ?? "/" };
        if (opts.setCookie !== null) {
          headers["set-cookie"] =
            opts.setCookie ?? "next-auth.session-token=abc; Path=/; HttpOnly";
        }
        return jsonResponse({}, { ok: true, status: 302, headers });
      }
      return jsonResponse(opts.user ?? {}, {
        ok: (opts.sessionStatus ?? 200) < 400,
        status: opts.sessionStatus ?? 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("devuelve la sesión completa en el camino feliz", async () => {
    const fetchMock = mockLoginFlow({
      user: { user: { id: "u1", email: "a@b.com", name: "Ana", role: "teacher" } },
    });
    const res = await loginRequest("a@b.com", "pw123");
    expect(res).toEqual({
      cookie: "next-auth.session-token=abc",
      user: { id: "u1", email: "a@b.com", name: "Ana", role: "teacher" },
    });
    // El POST manda el token CSRF y las credenciales urlencoded.
    const call = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(call[0]).toContain("/api/auth/callback/credentials");
    expect(call[1].method).toBe("POST");
    expect(String(call[1].body)).toContain("csrfToken=t");
    expect(String(call[1].body)).toContain("email=a%40b.com");
  });

  it("devuelve null cuando el endpoint de csrf falla", async () => {
    const fetchMock = mockLoginFlow({ csrfOk: false });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
    // No intenta el callback cuando no hay token CSRF.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devuelve null cuando la respuesta de csrf no trae token", async () => {
    mockLoginFlow({ omitCsrfToken: true });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
  });

  it("devuelve null cuando el callback no devuelve cookie de sesión", async () => {
    mockLoginFlow({ setCookie: null });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
  });

  it("acepta la cookie __Secure- de producción", async () => {
    mockLoginFlow({
      setCookie: "__Secure-next-auth.session-token=xyz; Path=/",
      user: { user: { id: "u1", email: "a@b.com" } },
    });
    const res = await loginRequest("a@b.com", "pw");
    expect(res?.cookie).toBe("__Secure-next-auth.session-token=xyz");
  });

  it("acepta la sesión aunque el callback no devuelva cabecera location", async () => {
    mockLoginFlow({
      omitLocation: true,
      user: { user: { id: "u1", email: "a@b.com" } },
    });
    const res = await loginRequest("a@b.com", "pw");
    expect(res?.cookie).toBe("next-auth.session-token=abc");
  });

  it("devuelve null cuando /api/auth/session responde con error", async () => {
    mockLoginFlow({ sessionStatus: 401 });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
  });

  it("devuelve null cuando la sesión no trae usuario", async () => {
    mockLoginFlow({ user: {} });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
  });

  it("devuelve null cuando el usuario no trae email", async () => {
    mockLoginFlow({ user: { user: { id: "u1" } } });
    expect(await loginRequest("a@b.com", "pw")).toBeNull();
  });

  it("rellena name null y role user por omisión", async () => {
    mockLoginFlow({ user: { user: { id: "u1", email: "a@b.com" } } });
    const res = await loginRequest("a@b.com", "pw");
    expect(res?.user).toEqual({ id: "u1", email: "a@b.com", name: null, role: "user" });
  });

  it("propaga el error de red del endpoint de csrf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(loginRequest("a@b.com", "pw")).rejects.toThrow("fetch failed");
  });
});

describe("registerRequest", () => {
  it("propagates server 410 message (registro con correo deshabilitado)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 410,
      json: async () => ({ success: false, message: "El registro con correo está deshabilitado. Registrate con Google." }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const res = await registerRequest("a@b.com", "password123");
    expect(res.ok).toBe(false);
    expect(res.requiresVerification).toBe(false);
    expect(res.message).toBe("El registro con correo está deshabilitado. Registrate con Google.");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/register"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to default ES message on 410 without body", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 410,
      json: async () => {
        throw new SyntaxError("empty body");
      },
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const res = await registerRequest("a@b.com", "password123");
    expect(res.ok).toBe(false);
    expect(res.message).toBe(REGISTRATION_DISABLED_MESSAGE);
  });

  it("keeps success path when server allows registration", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, requiresVerification: false }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const res = await registerRequest("a@b.com", "password123", "Ana");
    expect(res).toEqual({ ok: true, requiresVerification: false, message: "Cuenta creada. Ya puedes entrar." });
  });

  it("returns connection error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await registerRequest("a@b.com", "password123");
    expect(res).toEqual({ ok: false, requiresVerification: false, message: "Error de conexión." });
  });

  it("pide la verificación por correo cuando el servidor lo exige", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, requiresVerification: true }),
      } as unknown as Response))
    );
    const res = await registerRequest("a@b.com", "password123");
    expect(res).toEqual({
      ok: true,
      requiresVerification: true,
      message: "Cuenta creada. Revisa tu correo para verificar.",
    });
  });

  it("propaga el mensaje del servidor cuando el registro falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "El correo ya está registrado." }),
      } as unknown as Response))
    );
    const res = await registerRequest("a@b.com", "password123");
    expect(res).toEqual({
      ok: false,
      requiresVerification: false,
      message: "El correo ya está registrado.",
    });
  });

  it("usa el mensaje genérico cuando el fallo no trae mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({}),
      } as unknown as Response))
    );
    const res = await registerRequest("a@b.com", "password123");
    expect(res).toEqual({
      ok: false,
      requiresVerification: false,
      message: "No se pudo registrar.",
    });
  });

  it("normaliza el cuerpo con email y nombre sin espacios", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    await registerRequest("  a@b.com  ", "password123", "  Ana  ");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({
      email: "a@b.com",
      password: "password123",
      name: "Ana",
    });
  });
});

describe("recoverRequest", () => {
  it("confirma la recuperación cuando el servidor responde ok", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const res = await recoverRequest("  a@b.com  ");
    expect(res).toEqual({ ok: true, message: "Si el correo existe, recibirás un enlace." });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain("/api/auth/recover");
    expect(JSON.parse(String(call[1].body))).toEqual({ email: "a@b.com" });
  });

  it("informa el fallo cuando el servidor responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 500 })));
    const res = await recoverRequest("a@b.com");
    expect(res).toEqual({ ok: false, message: "No se pudo solicitar la recuperación." });
  });

  it("informa el error de conexión cuando la red falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      })
    );
    const res = await recoverRequest("a@b.com");
    expect(res).toEqual({ ok: false, message: "Error de conexión." });
  });
});

describe("resetRequest", () => {
  it("confirma el cambio de contraseña cuando el servidor responde ok", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await resetRequest("token123", "nueva-clave");
    expect(res).toEqual({ ok: true, message: "Contraseña actualizada. Ya puedes entrar." });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain("/api/auth/reset");
    expect(JSON.parse(String(call[1].body))).toEqual({
      token: "token123",
      password: "nueva-clave",
    });
  });

  it("propaga el mensaje del servidor cuando el token no es válido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, message: "El enlace expiró." }, { ok: false, status: 400 }))
    );
    const res = await resetRequest("token123", "nueva-clave");
    expect(res).toEqual({ ok: false, message: "El enlace expiró." });
  });

  it("usa el mensaje por omisión cuando el fallo no trae mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({}, { ok: false, status: 400 }))
    );
    const res = await resetRequest("token123", "nueva-clave");
    expect(res).toEqual({ ok: false, message: "Enlace inválido o expirado." });
  });

  it("absorbe el error de parseo de un cuerpo no-JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
          }) as unknown as Response
      )
    );
    const res = await resetRequest("token123", "nueva-clave");
    // El parseo fallido se reporta como respuesta inválida, no como error de red.
    expect(res.ok).toBe(false);
    expect(res.message).toBe("Respuesta inválida del servidor.");
  });

  it("informa el error de conexión cuando la red falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      })
    );
    const res = await resetRequest("token123", "nueva-clave");
    expect(res).toEqual({ ok: false, message: "Error de conexión." });
  });
});

/**
 * Hardening de producción: la URL base debe ser HTTPS cuando `__DEV__` es
 * falso. El módulo se re-evalua con `vi.resetModules()` para poder observar
 * cada rama del guard.
 */
describe("guard de HTTPS en producción", () => {
  async function importarCon(opts: {
    url?: string;
    dev?: boolean | undefined;
  }): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const prevUrl = process.env.EXPO_PUBLIC_API_URL;
    if (opts.url === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = opts.url;
    vi.resetModules();
    vi.stubGlobal("__DEV__", opts.dev);
    try {
      await import("./api");
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
      if (prevUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
      else process.env.EXPO_PUBLIC_API_URL = prevUrl;
    }
  }

  it("lanza al importar en producción con una URL base sin HTTPS", async () => {
    const res = await importarCon({
      url: "http://insecure.example.com",
      dev: false,
    });
    expect(res.ok).toBe(false);
    expect(String((res as { error: unknown }).error)).toMatch(/HTTPS/);
  });

  it("permite una URL sin HTTPS en desarrollo", async () => {
    const res = await importarCon({
      url: "http://localhost:3000",
      dev: true,
    });
    expect(res.ok).toBe(true);
  });

  it("permite una URL HTTPS en producción", async () => {
    const res = await importarCon({
      url: "https://api.example.com",
      dev: false,
    });
    expect(res.ok).toBe(true);
  });

  it("no evalúa el guard cuando __DEV__ no está definido", async () => {
    const res = await importarCon({
      url: "http://insecure.example.com",
      dev: undefined,
    });
    expect(res.ok).toBe(true);
  });
});
