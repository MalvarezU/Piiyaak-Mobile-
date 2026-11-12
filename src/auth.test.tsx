import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import {
  apiFetch,
  loginRequest,
  REGISTRATION_DISABLED_MESSAGE,
  type SessionState,
} from "./api";
import { AuthProvider, useAuth } from "./auth";

/**
 * `AuthProvider` / `useAuth`: restauración de sesión, login, registro y logout.
 *
 * La red se mockea a nivel de módulo (`./api`): `auth.tsx` solo depende de
 * `apiFetch` (validación contra el servidor) y `loginRequest` (alta de
 * sesión). `expo-secure-store` ya viene mockeado globalmente en
 * `jest.setup.tsx` con un mapa en memoria.
 */

jest.mock("./api", () => {
  const actual = jest.requireActual<typeof import("./api")>("./api");
  return {
    ...actual,
    apiFetch: jest.fn(),
    loginRequest: jest.fn(),
  };
});

const SESSION_KEY = "piiyaak:session";

const mockApiFetch = jest.mocked(apiFetch);
const mockLoginRequest = jest.mocked(loginRequest);
const mockGetItem = jest.mocked(SecureStore.getItemAsync);
const mockSetItem = jest.mocked(SecureStore.setItemAsync);
const mockDeleteItem = jest.mocked(SecureStore.deleteItemAsync);

const STORED_SESSION: SessionState = {
  cookie: "next-auth.session-token=abc123",
  user: { id: "u1", email: "ana@example.com", name: "Ana", role: "user" },
};

/** Respuesta mínima con la forma que consume `auth.tsx` (`ok` + `json`). */
function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 401): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("AuthProvider / useAuth", () => {
  beforeEach(async () => {
    // Limpia el store en memoria antes de borrar los registros de las
    // llamadas: el mock global comparte un `Map` entre tests del archivo.
    await SecureStore.deleteItemAsync(SESSION_KEY);
    jest.clearAllMocks();
    mockApiFetch.mockReset();
    mockLoginRequest.mockReset();
  });

  it("restaura la sesión guardada en SecureStore al montar", async () => {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(STORED_SESSION));
    mockApiFetch.mockResolvedValue(
      jsonResponse({
        user: { id: "u1", email: "ana@example.com", name: "Ana", role: "user" },
      })
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toEqual(STORED_SESSION);
    // La validación se hace contra el servidor usando la cookie guardada.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/auth/session", {}, STORED_SESSION);
    // Una sesión válida NO se borra del storage.
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it("elimina la sesión guardada cuando el servidor la rechaza (expirada)", async () => {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(STORED_SESSION));
    mockApiFetch.mockResolvedValue(jsonResponse({ error: "unauthorized" }, false, 401));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("elimina la sesión guardada cuando el servidor no devuelve un usuario válido", async () => {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(STORED_SESSION));
    // 200 pero sin `user.id` / `user.email`: la sesión no es utilizable.
    mockApiFetch.mockResolvedValue(jsonResponse({ user: { name: "Ana" } }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("elimina la sesión guardada cuando el JSON persistido es inválido", async () => {
    await SecureStore.setItemAsync(SESSION_KEY, "{no-es-json");
    mockApiFetch.mockResolvedValue(jsonResponse({ user: { id: "u1", email: "a@b.c" } }));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("no llama al servidor ni borra nada cuando no hay sesión guardada", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it("ready pasa a true solo cuando termina la restauración", async () => {
    let resolveItem: (value: string | null) => void = () => {};
    const pendiente = new Promise<string | null>((resolve) => {
      resolveItem = resolve;
    });
    mockGetItem.mockImplementationOnce(() => pendiente);

    const { result } = renderHook(() => useAuth(), { wrapper });

    // Mientras la restauración no terminó, el provider no está listo.
    expect(result.current.ready).toBe(false);
    expect(result.current.session).toBeNull();

    resolveItem(null);
    await waitFor(() => expect(result.current.ready).toBe(true));
  });

  it("login guarda la sesión en SecureStore y la expone", async () => {
    mockLoginRequest.mockResolvedValue(STORED_SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.login("ana@example.com", "secreto");
    });

    expect(ok).toBe(true);
    expect(result.current.session).toEqual(STORED_SESSION);
    expect(mockSetItem).toHaveBeenCalledWith(SESSION_KEY, JSON.stringify(STORED_SESSION));
  });

  it("login normaliza el correo (trim) antes de llamar al servidor", async () => {
    mockLoginRequest.mockResolvedValue(STORED_SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.login("  ana@example.com  ", "secreto");
    });

    expect(mockLoginRequest).toHaveBeenCalledWith("ana@example.com", "secreto");
  });

  it("login devuelve false y no guarda nada cuando las credenciales son inválidas", async () => {
    mockLoginRequest.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    let ok = true;
    await act(async () => {
      ok = await result.current.login("ana@example.com", "mala");
    });

    expect(ok).toBe(false);
    expect(result.current.session).toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("login expone la sesión aunque el storage falle (best-effort)", async () => {
    mockLoginRequest.mockResolvedValue(STORED_SESSION);
    mockSetItem.mockRejectedValueOnce(new Error("secure store no disponible"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.login("ana@example.com", "secreto");
    });

    expect(ok).toBe(true);
    expect(result.current.session).toEqual(STORED_SESSION);
  });

  it("register devuelve el aviso de registro deshabilitado sin llamar al servidor", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    const res = await result.current.register("ana@example.com", "secreto", "Ana");

    expect(res).toEqual({ ok: false, message: REGISTRATION_DISABLED_MESSAGE });
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockLoginRequest).not.toHaveBeenCalled();
  });

  it("logout limpia la sesión guardada y la sesión en memoria", async () => {
    mockLoginRequest.mockResolvedValue(STORED_SESSION);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.login("ana@example.com", "secreto");
    });
    expect(result.current.session).not.toBeNull();

    act(() => {
      result.current.logout();
    });

    await waitFor(() => expect(result.current.session).toBeNull());
    expect(mockDeleteItem).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("useAuth fuera del provider devuelve el contexto por defecto (sin sesión)", () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.session).toBeNull();
    expect(result.current.ready).toBe(false);
  });
});
