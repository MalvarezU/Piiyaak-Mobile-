import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, fireEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/** Router con spies: la pantalla navega a la ficha de la palabra pulsada. */
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
  usePathname: () => "/historial",
  useSegments: () => [],
}));

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

import Historial from "../historial";
import { setDbDouble, type DbDouble } from "../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/**
 * Pantalla Historial: lista de fichas vistas, estado vacío, limpieza del
 * historial y pull-to-refresh.
 */
describe("Historial (pantalla)", () => {
  let db: DbDouble;
  let store: MemoryWordStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new MemoryWordStore();
    db = setDbDouble({ store, history: [] });
  });

  it("muestra el estado vacío cuando todavía no se vio ninguna ficha", () => {
    render(<Historial />);
    expect(screen.getByText("Las fichas que abras aparecerán aquí.")).toBeTruthy();
    expect(screen.queryByText("Limpiar historial")).toBeNull();
  });

  it("lista las palabras vistas con su traducción en Nasa Yuwe", () => {
    setDbDouble({
      store,
      history: [
        makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa" }),
        makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü" }),
      ],
    });

    render(<Historial />);

    expect(screen.getByText("casa")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    expect(screen.getByText("agua")).toBeTruthy();
    expect(screen.getByText("mü")).toBeTruthy();
  });

  it("el botón Limpiar historial vacía el historial del store", async () => {
    const clearSpy = jest.spyOn(store, "clearHistory");
    setDbDouble({
      store,
      history: [makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa" })],
    });
    render(<Historial />);

    const user = userEvent.setup();
    await user.press(screen.getByText("Limpiar historial"));

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("el pull-to-refresh dispara la sincronización", async () => {
    const dbConHistorial = setDbDouble({
      store,
      history: [makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa" })],
    });
    render(<Historial />);

    // El `RefreshControl` real de RN está mockeado por el preset de jest.
    const [refreshControl] = screen.UNSAFE_root.findAll(
      (node) => typeof node.props?.onRefresh === "function"
    );
    expect(refreshControl).toBeDefined();
    await act(async () => {
      fireEvent(refreshControl!, "refresh");
    });

    expect(dbConHistorial.sync).toHaveBeenCalledTimes(1);
  });

  it("abre la ficha de la palabra pulsada", async () => {
    setDbDouble({
      store,
      history: [makeWord({ id: "w7", spanish: "casa", nasaYuwe: "tsa" })],
    });
    render(<Historial />);

    const user = userEvent.setup();
    await user.press(screen.getByText("casa"));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/ficha/[id]",
      params: { id: "w7" },
    });
  });
});
