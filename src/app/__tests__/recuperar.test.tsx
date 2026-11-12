import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/** API mockeada: la pantalla no debe pegarle al backend real. */
const mockRecoverRequest = jest.fn(
  async (_email: string): Promise<{ ok: boolean; message: string }> => ({
    ok: true,
    message: "Si el correo existe, recibirás un enlace.",
  })
);
jest.mock("../../api", () => ({
  ...(jest.requireActual("../../api") as Record<string, unknown>),
  recoverRequest: (email: string) => mockRecoverRequest(email),
}));

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
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  usePathname: () => "/recuperar",
  useSegments: () => [],
}));

import Recuperar from "../recuperar";

/**
 * Pantalla Recuperar: pide el correo, valida antes de llamar a la API y
 * muestra el mensaje que devuelve el servidor.
 */
describe("Recuperar (pantalla)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecoverRequest.mockImplementation(async () => ({
      ok: true,
      message: "Si el correo existe, recibirás un enlace.",
    }));
  });

  it("pide el correo antes de llamar a la API", async () => {
    render(<Recuperar />);

    const user = userEvent.setup();
    await user.press(screen.getByText("Enviar enlace"));

    expect(screen.getByText("Ingresa tu correo.")).toBeTruthy();
    expect(mockRecoverRequest).not.toHaveBeenCalled();
  });

  it("envía el correo escrito y muestra la respuesta del servidor", async () => {
    render(<Recuperar />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Correo"), "ana@piiyaak.app");
    await user.press(screen.getByText("Enviar enlace"));

    expect(mockRecoverRequest).toHaveBeenCalledWith("ana@piiyaak.app");
    expect(
      await screen.findByText("Si el correo existe, recibirás un enlace.")
    ).toBeTruthy();
  });

  it("muestra el error cuando la API no puede resolver la recuperación", async () => {
    mockRecoverRequest.mockImplementation(async () => ({
      ok: false,
      message: "No se pudo solicitar la recuperación.",
    }));
    render(<Recuperar />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Correo"), "ana@piiyaak.app");
    await user.press(screen.getByText("Enviar enlace"));

    expect(
      await screen.findByText("No se pudo solicitar la recuperación.")
    ).toBeTruthy();
  });

  it("el enlace Volver regresa a la pantalla anterior", async () => {
    render(<Recuperar />);

    const user = userEvent.setup();
    await user.press(screen.getByText("Volver"));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
