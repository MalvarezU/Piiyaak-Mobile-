import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { loginRequest, REGISTRATION_DISABLED_MESSAGE, type SessionState, apiFetch } from "./api";

const SESSION_KEY = "piiyaak:session";

interface AuthContextValue {
  session: SessionState | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, name?: string) => Promise<{ ok: boolean; message: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  ready: false,
  login: async () => false,
  register: async () => ({ ok: false, message: "" }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (raw && alive) {
          const parsed = JSON.parse(raw) as SessionState;
          // validate against server
          const res = await apiFetch("/api/auth/session", {}, parsed);
          if (res.ok) {
            const me = (await res.json()) as {
              user?: { id?: string; email?: string; name?: string | null; role?: string };
            };
            if (me.user?.id && me.user?.email) {
              const validated: SessionState = {
                cookie: parsed.cookie,
                user: {
                  id: me.user.id,
                  email: me.user.email,
                  name: me.user.name ?? null,
                  role: me.user.role ?? parsed.user.role ?? "user",
                },
              };
              if (alive) setSession(validated);
            } else if (alive) {
              await SecureStore.deleteItemAsync(SESSION_KEY);
            }
          } else if (alive) {
            await SecureStore.deleteItemAsync(SESSION_KEY);
          }
        }
      } catch {
        if (alive) {
          try {
            await SecureStore.deleteItemAsync(SESSION_KEY);
          } catch {
            // ignore
          }
        }
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const s = await loginRequest(email.trim(), password);
    if (s) {
      setSession(s);
      try {
        await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
      } catch {
        // best-effort
      }
    }
    return !!s;
  }, []);

  // Fase 3 APK (Google-first): el registro online con correo está
  // deshabilitado en el servidor (410 Gone). No se hace POST a /register;
  // se devuelve el aviso para dirigir a la web. Se mantiene la firma para
  // no romper callers (la pantalla /registro ya es solo informativa).
  // OAuth móvil queda para una fase futura.
  const register = useCallback(async (_email: string, _password: string, _name?: string) => {
    return { ok: false, message: REGISTRATION_DISABLED_MESSAGE };
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ session, ready, login, register, logout }),
    [session, ready, login, register, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}