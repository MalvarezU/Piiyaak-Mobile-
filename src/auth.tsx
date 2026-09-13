import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { loginRequest, type SessionState } from "./api";

interface AuthContextValue {
  session: SessionState | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  login: async () => false,
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const s = await loginRequest(email.trim(), password);
    if (s) setSession(s);
    return !!s;
  }, []);

  const logout = useCallback(() => setSession(null), []);

  const value = useMemo(() => ({ session, login, logout }), [session, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
