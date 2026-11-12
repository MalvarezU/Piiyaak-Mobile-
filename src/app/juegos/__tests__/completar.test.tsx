import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide, renderedTexts } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

import Completar from "../completar";
import { setDbDouble } from "../../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/**
 * Con `Math.random` fijo el Fisher-Yates de la pantalla es la identidad:
 * las palabras salen en el orden en que se guardaron en el store.
 */
const RANDOM_FIJO = 0.999999;

const WORDS = [
  makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
  makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
  makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "cielo" }),
  makeWord({ id: "w4", spanish: "luna", nasaYuwe: "ki", category: "cielo" }),
];

/** La pista oculta letras: tiene el mismo largo que la palabra y "_". */
function pistaRenderizada(): string | undefined {
  return renderedTexts().find((t) => t.includes("_") && t.length <= 5);
}

/**
 * Pantalla Completar: muestra la pista, comprueba la respuesta escrita y
 * avanza hasta el resumen final.
 */
describe("Completar (pantalla)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    const store = new MemoryWordStore();
    await store.upsertWords(WORDS);
    setDbDouble({ store });
    jest.spyOn(Math, "random").mockReturnValue(RANDOM_FIJO);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("muestra la palabra en español y la pista con letras ocultas", async () => {
    render(<Completar />);

    expect(await screen.findByText("casa")).toBeTruthy();
    expect(screen.getByText("Completa la traducción en Nasa Yuwe:")).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();

    const pista = pistaRenderizada();
    expect(pista).toBeDefined();
    expect(pista).toHaveLength("tsa".length);
  });

  it("acepta la respuesta correcta y suma el acierto", async () => {
    render(<Completar />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Escribe la palabra completa..."), "tsa");
    await user.press(screen.getByRole("button", { name: "Comprobar" }));

    expect(screen.getByText("✓ Correcto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeTruthy();
  });

  it("muestra la respuesta correcta cuando la respuesta es incorrecta", async () => {
    render(<Completar />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText("Escribe la palabra completa..."),
      "zzz"
    );
    await user.press(screen.getByRole("button", { name: "Comprobar" }));

    expect(screen.getByText("✗ La respuesta era: tsa")).toBeTruthy();
  });

  it("avanza a la palabra siguiente al pulsar Siguiente", async () => {
    render(<Completar />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Escribe la palabra completa..."), "tsa");
    await user.press(screen.getByRole("button", { name: "Comprobar" }));
    await user.press(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("agua")).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it("termina el juego y muestra los aciertos", async () => {
    render(<Completar />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    for (const nasaYuwe of ["tsa", "mü", "mi", "ki"]) {
      await user.type(
        screen.getByPlaceholderText("Escribe la palabra completa..."),
        nasaYuwe
      );
      await user.press(screen.getByRole("button", { name: "Comprobar" }));
      await user.press(screen.getByRole("button", { name: "Siguiente" }));
    }

    expect(await screen.findByText("¡Terminado!")).toBeTruthy();
    expect(screen.getByText("Aciertos: 4 / 4")).toBeTruthy();
  }, 20000);
});
