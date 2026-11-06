/**
 * Cliente HTTP de la app hacia la plataforma Piiyaak (B3.3).
 *
 * La URL base se configura por entorno (dev/prod). La sesión se guarda
 * como cookie de NextAuth en memoria + usuario persistido.
 */

// URL de producción: pendiente de dominio en Hostinger (EAS: app.config extra). Se mantiene la actual mientras el backend vivo responda ahí.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://diccionario-nasa-liart.vercel.app";

// Hardening: en producción la URL base debe ser HTTPS.
if (typeof __DEV__ !== "undefined" && !__DEV__ && !API_BASE_URL.startsWith("https://")) {
  throw new Error("API_BASE_URL debe usar HTTPS en producción");
}

export interface SessionState {
  cookie: string;
  user: { id: string; email: string; name: string | null; role: string };
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  session: SessionState | null = null,
  timeoutMs = 15000
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (session) headers.set("Cookie", session.cookie);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

/**
 * Registro de cuenta nueva (B1.1/B1.2).
 * Devuelve { ok, requiresVerification, message }.
 *
 * Fase 3 APK (Google-first): el servidor responde 410 Gone al registro
 * con correo. Se propaga el mensaje del servidor (ES) o un texto
 * por defecto que dirige a la web.
 */
export const REGISTRATION_DISABLED_MESSAGE =
  "Para crear tu cuenta, registrate en la web con Google y después creá tu contraseña en tu perfil para entrar acá.";

export async function registerRequest(
  email: string,
  password: string,
  name?: string
): Promise<{ ok: boolean; requiresVerification: boolean; message: string }> {
  const base = API_BASE_URL;
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password, name: name?.trim() || undefined }),
    });
    let body: { success?: boolean; requiresVerification?: boolean; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = {};
    }
    if (res.status === 410) {
      return {
        ok: false,
        requiresVerification: false,
        message: body.message ?? REGISTRATION_DISABLED_MESSAGE,
      };
    }
    if (res.ok && body.success) {
      return {
        ok: true,
        requiresVerification: !!body.requiresVerification,
        message: body.requiresVerification
          ? "Cuenta creada. Revisa tu correo para verificar."
          : "Cuenta creada. Ya puedes entrar.",
      };
    }
    return { ok: false, requiresVerification: false, message: body.message ?? "No se pudo registrar." };
  } catch {
    return { ok: false, requiresVerification: false, message: "Error de conexión." };
  }
}

/**
 * Solicitar recuperación de contraseña (B1.4). Siempre ok (anti-enumeración).
 */
export async function recoverRequest(email: string): Promise<{ ok: boolean; message: string }> {
  const base = API_BASE_URL;
  try {
    const res = await fetch(`${base}/api/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (res.ok) {
      return { ok: true, message: "Si el correo existe, recibirás un enlace." };
    }
    return { ok: false, message: "No se pudo solicitar la recuperación." };
  } catch {
    return { ok: false, message: "Error de conexión." };
  }
}

/**
 * Reset de contraseña con token (B1.4).
 */
export async function resetRequest(
  token: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
  const base = API_BASE_URL;
  try {
    const res = await fetch(`${base}/api/auth/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const body = (await res.json()) as { ok?: boolean; message?: string };
    if (res.ok && body.ok) {
      return { ok: true, message: "Contraseña actualizada. Ya puedes entrar." };
    }
    return { ok: false, message: body.message ?? "Enlace inválido o expirado." };
  } catch {
    return { ok: false, message: "Error de conexión." };
  }
}
