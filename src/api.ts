/**
 * Cliente HTTP de la app hacia la plataforma Piiyaak (B3.3).
 *
 * La URL base se configura por entorno (dev/prod). La sesión se guarda
 * como cookie de NextAuth en memoria + usuario persistido.
 */

// Cambiar por la URL de producción al publicar (EAS: app.config extra).
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://diccionario-nasa-liart.vercel.app";

export interface SessionState {
  cookie: string;
  user: { id: string; email: string; name: string | null; role: string };
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  session: SessionState | null = null
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (session) headers.set("Cookie", session.cookie);
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

/**
 * Login headless contra NextAuth credentials:
 * 1) GET csrf 2) POST callback con csrfToken 3) captura set-cookie.
 * Devuelve la sesión lista para apiFetch (o null si falla).
 */
export async function loginRequest(
  email: string,
  password: string
): Promise<SessionState | null> {
  const base = API_BASE_URL;
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  if (!csrfRes.ok) return null;
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) return null;

  const body = new URLSearchParams({ csrfToken, email, password });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  // Éxito = 302 a / con cookie de sesión (error => 302 a /?error=...)
  const location = res.headers.get("location") ?? "";
  const setCookie = res.headers.get("set-cookie") ?? "";
  const sessionCookie = setCookie
    .split(",")
    .map((c) => c.trim())
    .find((c) => c.startsWith("next-auth.session-token=") || c.startsWith("__Secure-next-auth.session-token="));
  if (!sessionCookie || location.includes("error=")) return null;

  const meRes = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: sessionCookie.split(";")[0]! },
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as {
    user?: { id?: string; email?: string; name?: string | null; role?: string };
  };
  if (!me.user?.id || !me.user?.email) return null;
  return {
    cookie: sessionCookie.split(";")[0]!,
    user: {
      id: me.user.id,
      email: me.user.email,
      name: me.user.name ?? null,
      role: me.user.role ?? "user",
    },
  };
}
