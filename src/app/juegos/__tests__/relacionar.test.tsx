import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide, renderedStyles } from "../../__tests__/_test-utils";
import { theme } from "../../../theme";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

import Relacionar from "../relacionar";
import { setDbDouble } from "../../../test/doubles/db-context";

/**
 * Con `Math.random` fijo el Fisher-Yates de la pantalla es la identidad: el
 * par de la derecha corresponde, en el mismo orden, al de la izquierda.
 */
const RANDOM_FIJO = 0.999999;

const WORDS = [
  makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
  makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
  makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "cielo" }),
  makeWord({ id: "w4", spanish: "luna", nasaYuwe: "ki", category: "cielo" }),
];

/**
 * Pantalla Relacionar: une la palabra en español con su pareja en Nasa
 * Yuwe, avisa cuando no son pareja y reinicia el tablero.
 */
describe("Relacionar (pantalla)", () => {
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

  it("muestra las dos columnas con las palabras", async () => {
    render(<Relacionar />);

    expect(await screen.findByText("Español")).toBeTruthy();
    expect(screen.getByText("Nasa Yuwe")).toBeTruthy();
    expect(screen.getByText("casa")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    expect(screen.getByText("Movimientos: 0")).toBeTruthy();
  });

  it("cuenta los movimientos al unir dos fichas", async () => {
    render(<Relacionar />);
    await screen.findByText("Español");

    const user = userEvent.setup();
    await user.press(screen.getByText("casa"));
    await user.press(screen.getByText("tsa"));

    expect(screen.getByText("Movimientos: 1")).toBeTruthy();
  });

  it("marca en rojo la unión que no es pareja", async () => {
    render(<Relacionar />);
    await screen.findByText("Español");

    const user = userEvent.setup();
    await user.press(screen.getByText("casa"));
    await user.press(screen.getByText("mü"));

    // La ficha marcada con error usa el borde de peligro del tema.
    expect(renderedStyles().some((s) => s.borderColor === theme.danger)).toBe(true);
  });

  it("emparejar todas las parejas muestra el estado Completado", async () => {
    render(<Relacionar />);
    await screen.findByText("Español");

    const user = userEvent.setup();
    const parejas: [string, string][] = [
      ["casa", "tsa"],
      ["agua", "mü"],
      ["sol", "mi"],
      ["luna", "ki"],
    ];
    for (const [es, ny] of parejas) {
      await user.press(screen.getByText(es));
      await user.press(screen.getByText(ny));
    }

    expect(await screen.findByText("Completado")).toBeTruthy();
    expect(screen.getByText("Movimientos: 4")).toBeTruthy();
  });

  it("el botón Reiniciar vuelve a armar el tablero", async () => {
    render(<Relacionar />);
    await screen.findByText("Español");

    const user = userEvent.setup();
    await user.press(screen.getByText("casa"));
    await user.press(screen.getByText("tsa"));
    await user.press(screen.getByRole("button", { name: "Reiniciar" }));

    expect(await screen.findByText("Movimientos: 0")).toBeTruthy();
  });
});
