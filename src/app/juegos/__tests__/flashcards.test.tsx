import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

import Flashcards from "../flashcards";
import { setDbDouble } from "../../../test/doubles/db-context";

/**
 * Con `Math.random` fijo el Fisher-Yates de la pantalla es la identidad: la
 * primera opción de cada pregunta es la respuesta correcta.
 */
const RANDOM_FIJO = 0.999999;

const WORDS = [
  makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
  makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
  makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "cielo" }),
  makeWord({ id: "w4", spanish: "luna", nasaYuwe: "ki", category: "cielo" }),
];

/** Responde la ronda actual con la opción indicada y avanza. */
async function responder(user: ReturnType<typeof userEvent.setup>, opcion: string) {
  await user.press(screen.getByText(opcion));
  await user.press(screen.getByText("Siguiente"));
}

/**
 * Pantalla Flashcards: pregunta de opción múltiple, puntaje y reinicio.
 */
describe("Flashcards (pantalla)", () => {
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

  it("muestra la pregunta con sus cuatro opciones", async () => {
    render(<Flashcards />);

    expect(await screen.findByText("¿Cómo se dice en Nasa Yuwe?")).toBeTruthy();
    expect(screen.getByText("casa")).toBeTruthy();
    expect(screen.getByText("1 / 4")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    expect(screen.getByText("mü")).toBeTruthy();
    expect(screen.getByText("mi")).toBeTruthy();
    expect(screen.getByText("ki")).toBeTruthy();
  });

  it("suma el acierto cuando se elige la respuesta correcta", async () => {
    render(<Flashcards />);
    await screen.findByText("¿Cómo se dice en Nasa Yuwe?");

    const user = userEvent.setup();
    await responder(user, "tsa");
    await responder(user, "mü");
    await responder(user, "mi");
    await responder(user, "ki");

    expect(await screen.findByText("¡Terminado!")).toBeTruthy();
    expect(screen.getByText("Puntaje: 4 / 4")).toBeTruthy();
  });

  it("no suma cuando se elige una opción incorrecta", async () => {
    render(<Flashcards />);
    await screen.findByText("¿Cómo se dice en Nasa Yuwe?");

    const user = userEvent.setup();
    await responder(user, "mü");
    await responder(user, "mü");
    await responder(user, "mi");
    await responder(user, "ki");

    expect(await screen.findByText("Puntaje: 3 / 4")).toBeTruthy();
  });

  it("el botón Reintentar reinicia el juego", async () => {
    render(<Flashcards />);
    await screen.findByText("¿Cómo se dice en Nasa Yuwe?");

    const user = userEvent.setup();
    await responder(user, "tsa");
    await responder(user, "mü");
    await responder(user, "mi");
    await responder(user, "ki");
    await screen.findByText("¡Terminado!");

    await user.press(screen.getByText("Reintentar"));

    expect(await screen.findByText("1 / 4")).toBeTruthy();
    expect(screen.getByText("casa")).toBeTruthy();
  });
});
