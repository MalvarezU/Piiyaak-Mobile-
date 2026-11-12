import { jest } from "@jest/globals";

/**
 * Doble de `useAuth()` para tests de pantallas.
 *
 * Mismo patrón que `db-context`: el test mockea el módulo `auth` y delega acá.
 */

export interface SessionState {
  token: string;
  email: string;
  name?: string | null;
}

export interface AuthDouble {
  session: SessionState | null;
  ready: boolean;
  login: jest.Mock<(email: string, password: string) => Promise<void>>;
  register: jest.Mock<(email: string, password: string, name?: string) => Promise<void>>;
  logout: jest.Mock<() => void>;
}

export let currentAuth: AuthDouble = createAuthDouble();

export function createAuthDouble(overrides: Partial<AuthDouble> = {}): AuthDouble {
  return {
    session: null,
    ready: true,
    login: jest.fn(async () => undefined),
    register: jest.fn(async () => undefined),
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
