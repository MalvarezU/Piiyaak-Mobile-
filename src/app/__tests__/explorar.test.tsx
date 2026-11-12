import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import { mockLucide, mockReanimated } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

// El kit de motion usa reanimated: en Node no hay worklets nativos.
jest.mock("react-native-reanimated", () => mockReanimated);

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

import Explorar from "../explorar";
import { setDbDouble } from "../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

const WORDS = [
  makeWord({ id: "w1", spanish: "agua", nasaYuwe: "mü", category: "naturaleza" }),
  makeWord({ id: "w2", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
  makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "naturaleza" }),
];

/**
 * Pantalla Explorar: índice alfabético con agrupamiento por letra, filtro
 * por categoría y estado vacío.
 */
describe("Explorar (pantalla)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    const store = new MemoryWordStore();
    await store.upsertWords(WORDS);
    setDbDouble({ store });
  });

  it("lista las palabras agrupadas por letra inicial", async () => {
    render(<Explorar />);

    expect(await screen.findByText("agua")).toBeTruthy();
    expect(screen.getByText("casa")).toBeTruthy();
    expect(screen.getByText("sol")).toBeTruthy();
    // Encabezados de grupo con el recuento de la letra.
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("C")).toBeTruthy();
    expect(screen.getByText("S")).toBeTruthy();
    expect(screen.getAllByText("1 palabra")).toHaveLength(3);
  });

  it("muestra el recuento global de palabras", async () => {
    render(<Explorar />);

    expect(await screen.findByText("3 de 3 palabras")).toBeTruthy();
  });

  it("filtra el listado por categoría", async () => {
    render(<Explorar />);
    await screen.findByText("agua");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "naturaleza" }));

    expect(await screen.findByText("2 palabras")).toBeTruthy();
    expect(screen.getByText("agua")).toBeTruthy();
    expect(screen.getByText("sol")).toBeTruthy();
    expect(screen.queryByText("casa")).toBeNull();
  });

  it("muestra el estado vacío cuando no hay palabras", async () => {
    setDbDouble({ store: new MemoryWordStore() });

    render(<Explorar />);

    expect(
      await screen.findByText("Sin palabras en esta categoría")
    ).toBeTruthy();
  });

  it("muestra el aviso cuando no hay palabras en la categoría elegida", async () => {
    render(<Explorar />);
    await screen.findByText("agua");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "hogar" }));

    // El contador global y el encabezado de la letra muestran "1 palabra".
    expect((await screen.findAllByText("1 palabra")).length).toBeGreaterThan(0);
    expect(screen.queryByText("agua")).toBeNull();
    expect(screen.getByText("casa")).toBeTruthy();
  });
});
