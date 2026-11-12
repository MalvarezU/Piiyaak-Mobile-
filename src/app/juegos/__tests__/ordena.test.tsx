import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

import Ordena from "../ordena";
import { setDbDouble } from "../../../test/doubles/db-context";

/**
 * Con `Math.random` fijo el Fisher-Yates de la pantalla es la identidad: la
 * palabra elegida es la primera elegible del store y las fichas salen en el
 * orden en que las tokeniza el juego.
 */
const RANDOM_FIJO = 0.999999;

/** Palabras elegibles para "Ordena": en Nasa Yuwe de más de dos letras. */
const WORDS = [
  makeWord({ id: "o1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
  makeWord({ id: "o2", spanish: "agua", nasaYuwe: "mikh", category: "agua" }),
  makeWord({ id: "o3", spanish: "sol", nasaYuwe: "nasi", category: "cielo" }),
  makeWord({ id: "o4", spanish: "luna", nasaYuwe: "kima", category: "cielo" }),
];

/**
 * Pantalla Ordena: arma las fichas de la palabra, permite comprobar el
 * orden y avisa si la respuesta es correcta.
 */
describe("Ordena (pantalla)", () => {
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

  it("muestra la palabra en español y las fichas para ordenar", async () => {
    render(<Ordena />);

    expect(await screen.findByText("casa")).toBeTruthy();
    expect(screen.getByText("Ordena las fichas para formar:")).toBeTruthy();
    expect(screen.getByText("Ronda 1 / 5 | Puntaje: 0")).toBeTruthy();
    // Las tres fichas de "tsa".
    expect(screen.getByText("t")).toBeTruthy();
    expect(screen.getByText("s")).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
  });

  it("no deja comprobar mientras no haya fichas colocadas", async () => {
    render(<Ordena />);
    await screen.findByText("casa");

    expect(screen.getByRole("button", { name: "Comprobar" })).toBeDisabled();
    expect(screen.getByText("Toca las fichas de abajo")).toBeTruthy();
  });

  it("acepta el orden correcto y suma el acierto", async () => {
    render(<Ordena />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    for (const ficha of ["t", "s", "a"]) {
      await user.press(screen.getByText(ficha));
    }
    await user.press(screen.getByRole("button", { name: "Comprobar" }));

    expect(screen.getByText("✓ Correcto")).toBeTruthy();
  });

  it("muestra la respuesta cuando el orden es incorrecto", async () => {
    render(<Ordena />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    for (const ficha of ["a", "s", "t"]) {
      await user.press(screen.getByText(ficha));
    }
    await user.press(screen.getByRole("button", { name: "Comprobar" }));

    expect(screen.getByText("✗ Respuesta: tsa")).toBeTruthy();
  });

  it("devuelve una ficha al tocar la colocada", async () => {
    render(<Ordena />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.press(screen.getByText("t"));
    expect(screen.queryByText("Toca las fichas de abajo")).toBeNull();

    // La ficha colocada se toca de nuevo para devolverla al kiosco.
    await user.press(screen.getByText("t"));
    expect(screen.getByText("Toca las fichas de abajo")).toBeTruthy();
  });

  it("pasa a la ronda siguiente tras comprobar", async () => {
    render(<Ordena />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    for (const ficha of ["t", "s", "a"]) {
      await user.press(screen.getByText(ficha));
    }
    await user.press(screen.getByRole("button", { name: "Comprobar" }));
    await user.press(screen.getByRole("button", { name: "Siguiente" }));

    expect(await screen.findByText("Ronda 2 / 5 | Puntaje: 1")).toBeTruthy();
  });
});
