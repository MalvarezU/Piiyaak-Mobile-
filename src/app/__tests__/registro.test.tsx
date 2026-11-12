import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/** Router con spies: la pantalla reenvía a la web y vuelve atrás. */
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
  usePathname: () => "/registro",
  useSegments: () => [],
}));

import Registro from "../registro";
import { REGISTRATION_DISABLED_MESSAGE } from "../../api";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/**
 * Pantalla Registro: desde la Fase 3 (Google-first) el servidor responde
 * 410 Gone al registro con correo, así que la ruta se conserva como aviso
 * en vez de 404: no hay formulario ni llamada a la API.
 */
describe("Registro (pantalla)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("muestra el aviso de que el registro se hace en la web", () => {
    render(<Registro />);
    expect(screen.getByText("Crear cuenta")).toBeTruthy();
    expect(screen.getByText(REGISTRATION_DISABLED_MESSAGE)).toBeTruthy();
  });

  it("no ofrece ningún campo de formulario", () => {
    render(<Registro />);
    expect(screen.queryByPlaceholderText("Correo")).toBeNull();
    expect(screen.queryByPlaceholderText("Contraseña")).toBeNull();
  });

  it("el botón Ir a entrar lleva a Ajustes", async () => {
    render(<Registro />);

    const user = userEvent.setup();
    await user.press(screen.getByText("Ir a entrar"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/ajustes");
  });

  it("el enlace Volver regresa a la pantalla anterior", async () => {
    render(<Registro />);

    const user = userEvent.setup();
    await user.press(screen.getByText("Volver"));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
