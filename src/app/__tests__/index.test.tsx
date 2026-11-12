import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import type { WordRow } from "../../db/types";
import { mockLucide, mockReanimated } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

// El kit de motion usa reanimated: en Node no hay worklets nativos.
jest.mock("react-native-reanimated", () => mockReanimated);

/** La palabra del día se resuelve contra el backend: en tests es un doble. */
const mockLoadWordOfDay = jest.fn(
  async (_store: unknown, _date: string, _session: unknown): Promise<WordRow | null> =>
    null
);
jest.mock("../../db/word-of-day", () => ({
  loadWordOfDay: (store: unknown, date: string, session: unknown) =>
    mockLoadWordOfDay(store, date, session),
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
  usePathname: () => "/",
  useSegments: () => [],
}));

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

jest.mock("../../auth", () => require("../../test/doubles/auth").authDouble);

import Inicio from "../index";
import { setDbDouble } from "../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/** Monta la pantalla y deja que los efectos asíncronos se resuelvan. */
async function montarInicio() {
  render(<Inicio />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Home: módulos de navegación, búsqueda con debounce, palabra del día y
 * aviso de diccionario no listo.
 */
describe("Inicio (pantalla)", () => {
  let store: MemoryWordStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLoadWordOfDay.mockImplementation(async () => null);
    store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
    ]);
    setDbDouble({ store });
  });

  it("muestra los módulos de navegación", async () => {
    await montarInicio();

    expect(screen.getByText("Diccionario")).toBeTruthy();
    expect(screen.getByText("Juegos")).toBeTruthy();
    expect(screen.getByText("Cursos")).toBeTruthy();
  });

  it("busca palabras con el buscador", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "casa");

    // La búsqueda tiene debounce: el resultado llega de forma asíncrona.
    expect(await screen.findByText("casa")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
  });

  it("muestra el estado vacío cuando la búsqueda no encuentra nada", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "zzz");

    expect(await screen.findByText("Sin resultados")).toBeTruthy();
  });

  it("muestra la palabra del día cuando el backend la resuelve", async () => {
    mockLoadWordOfDay.mockImplementation(async () =>
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" })
    );

    await montarInicio();

    expect(await screen.findByText("Palabra del día")).toBeTruthy();
    expect(screen.getByText("mü")).toBeTruthy();
  });

  it("avisa que el diccionario offline todavía se está preparando", async () => {
    setDbDouble({ store, ready: false });

    await montarInicio();

    expect(screen.getByText("Preparando diccionario offline...")).toBeTruthy();
  });

  it("abre el módulo de cursos al tocar su tarjeta", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.press(screen.getByText("Cursos"));

    expect(mockRouter.push).toHaveBeenCalledWith("/cursos");
  });
});
