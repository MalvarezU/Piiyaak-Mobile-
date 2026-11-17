import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import type { WordRow } from "../../db/types";
import { theme } from "../../theme";
import { mockLucide, mockReanimated } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

// El kit de motion usa reanimated: en Node no hay worklets nativos.
jest.mock("react-native-reanimated", () => mockReanimated);

/** Las palabras sugeridas se resuelven localmente: en tests es un doble. */
const mockLoadSuggestedWords = jest.fn(
  async (_store: unknown, _date: string, _session?: unknown): Promise<WordRow[]> => []
);
jest.mock("../../db/suggested-words", () => ({
  loadSuggestedWords: (store: unknown, date: string, session?: unknown) =>
    mockLoadSuggestedWords(store, date, session),
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
 * Orden de aparición en el árbol renderizado: sirve para afirmar que el
 * input queda arriba y los resultados debajo en modo búsqueda.
 */
function ordenAparicion(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as { props?: { testID?: string }; children?: unknown };
    if (typeof n.props?.testID === "string") out.push(n.props.testID);
    if (n.children) walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}

/**
 * Home: módulos de navegación, búsqueda con debounce, palabra del día y
 * aviso de diccionario no listo.
 */
describe("Inicio (pantalla)", () => {
  let store: MemoryWordStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLoadSuggestedWords.mockImplementation(async () => []);
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

  it("muestra las palabras sugeridas cuando el store las resuelve", async () => {
    mockLoadSuggestedWords.mockImplementation(async () => [
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua", status: "PUBLISHED" }),
    ]);

    await montarInicio();

    expect(await screen.findByText("Palabras sugeridas")).toBeTruthy();
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

  it("oculta el home y lista resultados debajo del input al buscar", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "casa");

    // El input nunca se desmonta: sigue arriba y visible.
    expect(screen.getByPlaceholderText("Buscar palabra...")).toBeTruthy();
    // Carrusel y tiles se ocultan con display none (no se desmontan).
    expect(
      StyleSheet.flatten(screen.getByTestId("home-sugeridas", { includeHiddenElements: true }).props.style)
    ).toMatchObject({ display: "none" });
    expect(
      StyleSheet.flatten(screen.getByTestId("home-modulos", { includeHiddenElements: true }).props.style)
    ).toMatchObject({ display: "none" });
    // Acciones de modo búsqueda presentes.
    expect(screen.getByLabelText("Limpiar búsqueda")).toBeTruthy();
    expect(screen.getByText("Cancelar")).toBeTruthy();

    // El resultado llega por debounce y queda debajo del input.
    expect(await screen.findByText("casa")).toBeTruthy();
    const orden = ordenAparicion();
    expect(orden.indexOf("search-header")).toBeLessThan(orden.indexOf("casa"));
  });

  it("muestra Buscando… durante el debounce y Sin resultados solo al resolver vacía", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "zzz");

    // Debounce en vuelo: todavía no resolvió, sin falso "Sin resultados".
    expect(screen.getByText("Buscando…")).toBeTruthy();
    expect(screen.queryByText("Sin resultados")).toBeNull();

    // Resuelta vacía: aparece el vacío y se va el indicador.
    expect(await screen.findByText("Sin resultados")).toBeTruthy();
    expect(screen.queryByText("Buscando…")).toBeNull();
  });

  it("restaura el home completo al cancelar la búsqueda", async () => {
    mockLoadSuggestedWords.mockImplementation(async () => [
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua", status: "PUBLISHED" }),
    ]);
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "casa");
    expect(await screen.findByText("casa")).toBeTruthy();

    await user.press(screen.getByText("Cancelar"));

    // Home completo de vuelta: bloques visibles, sin resultados ni Cancelar.
    expect(
      StyleSheet.flatten(screen.getByTestId("home-sugeridas", { includeHiddenElements: true }).props.style)
    ).not.toMatchObject({ display: "none" });
    expect(
      StyleSheet.flatten(screen.getByTestId("home-modulos", { includeHiddenElements: true }).props.style)
    ).not.toMatchObject({ display: "none" });
    expect(screen.getByText("Palabras sugeridas")).toBeTruthy();
    expect(screen.getByText("Cursos")).toBeTruthy();
    expect(screen.queryByText("casa")).toBeNull();
    expect(screen.queryByText("Cancelar")).toBeNull();
  });

  it("el label usa el color de texto por defecto (sin foto de fondo)", async () => {
    mockLoadSuggestedWords.mockImplementation(async () => [
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua", status: "PUBLISHED" }),
    ]);
    await montarInicio();

    expect(
      StyleSheet.flatten(screen.getByText("Palabras sugeridas").props.style)
    ).not.toMatchObject({ color: theme.onTint });
  });

  it("Buscando… y Sin resultados usan color por defecto sobre crema", async () => {
    await montarInicio();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Buscar palabra..."), "zzz");

    expect(
      StyleSheet.flatten(screen.getByText("Buscando…").props.style)
    ).not.toMatchObject({ color: theme.onTint });
    expect(await screen.findByText("Sin resultados")).toBeTruthy();
    expect(
      StyleSheet.flatten(screen.getByText("Sin resultados").props.style)
    ).not.toMatchObject({ color: theme.onTint });
  });
});
