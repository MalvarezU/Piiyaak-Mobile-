import { jest } from "@jest/globals";
import type { SessionState as ApiSessionState } from "../../api";

/**
 * Re-exporta el tipo real de sesión de producción para que los consumidores
 * del doble usen la misma forma (`{ cookie, user }`).
 */
export type SessionState = ApiSessionState;

export interface AuthDouble {
  session: SessionState | null;
  ready: boolean;
  login: jest.Mock<(email: string, password: string) => Promise<boolean>>;
  register: jest.Mock<
    (email: string, password: string, name?: string) => Promise<{ ok: boolean; message: string }>
  >;
  logout: jest.Mock<() => void>;
}

export let currentAuth: AuthDouble = createAuthDouble();

export function createAuthDouble(overrides: Partial<AuthDouble> = {}): AuthDouble {
  return {
    session: null,
    ready: true,
    login: jest.fn(async () => true),
    register: jest.fn(async () => ({ ok: false, message: "" })),
    logout: jest.fn(() => undefined),
    ...overrides,
  };
}

export function setAuthDouble(overrides: Partial<AuthDouble> = {}): AuthDouble {
  currentAuth = createAuthDouble(overrides);
  return currentAuth;
}

export const authDouble = {
  useAuth: () => currentAuth,
  AUTH_UI_ENABLED: false,
};
