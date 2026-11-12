import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/** API mockeada: la pantalla no debe pegarle al backend real. */
const mockResetRequest = jest.fn(
  async (
    _token: string,
    _password: string
  ): Promise<{ ok: boolean; message: string }> => ({
    ok: true,
    message: "Contraseña actualizada. Ya puedes entrar.",
  })
);
jest.mock("../../api", () => ({
  ...(jest.requireActual("../../api") as Record<string, unknown>),
  resetRequest: (token: string, password: string) => mockResetRequest(token, password),
}));

/** El token llega por la ruta del enlace de recuperación. */
const mockParams: { token?: string } = { token: "tok-enlace-123" };
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
jest.mock("expo-router", () => ({
  __esModule: true,
  Link: ({ children }: { children: ReactNode }) => children,
  Stack: { Screen: () => null },
  Tabs: { Screen: () => null },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
  useGlobalSearchParams: () => ({}),
  usePathname: () => "/resetear",
  useSegments: () => [],
}));

import Resetear from "../resetear";

/**
 * Pantalla Resetear: precarga el token del enlace, valida token y contraseña
 * y avisa al usuario con el mensaje del servidor.
 */
describe("Resetear (pantalla)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.token = "tok-enlace-123";
    mockResetRequest.mockImplementation(async () => ({
      ok: true,
      message: "Contraseña actualizada. Ya puedes entrar.",
    }));
  });

  it("precarga el token que viene en el enlace", () => {
    render(<Resetear />);
    expect(screen.getByPlaceholderText("Token (del enlace)").props.value).toBe(
      "tok-enlace-123"
    );
  });

  it("exige token y contraseña de al menos 8 caracteres", async () => {
    render(<Resetear />);

    const user = userEvent.setup();
    await user.clear(screen.getByPlaceholderText("Token (del enlace)"));
    await user.type(screen.getByPlaceholderText("Nueva contraseña (mín. 8)"), "corta");
    await user.press(screen.getByText("Actualizar"));

    expect(
      screen.getByText("Token y contraseña (mín. 8) son requeridos.")
    ).toBeTruthy();
    expect(mockResetRequest).not.toHaveBeenCalled();
  });

  it("envía el token y la contraseña y muestra el resultado", async () => {
    render(<Resetear />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("Nueva contraseña (mín. 8)"),
      "secreto123"
    );
    await user.press(screen.getByText("Actualizar"));

    expect(mockResetRequest).toHaveBeenCalledWith("tok-enlace-123", "secreto123");
    expect(
      await screen.findByText("Contraseña actualizada. Ya puedes entrar.")
    ).toBeTruthy();
  });

  it("muestra el error cuando el enlace está vencido", async () => {
    mockResetRequest.mockImplementation(async () => ({
      ok: false,
      message: "Enlace inválido o expirado.",
    }));
    render(<Resetear />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("Nueva contraseña (mín. 8)"),
      "secreto123"
    );
    await user.press(screen.getByText("Actualizar"));

    expect(await screen.findByText("Enlace inválido o expirado.")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("vuelve al inicio cuando el reset es exitoso", async () => {
    render(<Resetear />);

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("Nueva contraseña (mín. 8)"),
      "secreto123"
    );
    await user.press(screen.getByText("Actualizar"));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/"), {
      timeout: 4000,
    });
  });
});
