import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide, renderedStyles } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

/**
 * `useWindowDimensions` decide el layout de la pantalla (vertical u
 * horizontal). Se mockea el módulo de React Native que lo implementa para
 * poder forzar la orientación en cada test.
 */
const mockUseWindowDimensions = jest.fn(() => ({
  width: 390,
  height: 844,
  scale: 3,
  fontScale: 1,
}));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockUseWindowDimensions(),
}));

/** Reproductor de audio doble: las llamadas son lo que el test afirma. */
const mockAudioPlayer = {
  load: jest.fn(async () => undefined),
  play: jest.fn(async () => undefined),
  pause: jest.fn(async () => undefined),
  seekTo: jest.fn(async () => undefined),
  unload: jest.fn(async () => undefined),
};
jest.mock("../../../audio-player", () => ({
  createAudioPlayer: () => mockAudioPlayer,
}));

/** `resolveAudioUri` real toca el sistema de archivos: acá no hay red ni disco. */
const mockResolveAudioUri = jest.fn(
  async (word: { id: string; audioUrl: string }) => word.audioUrl
);
jest.mock("../../../audio", () => ({
  resolveAudioUri: (word: { id: string; audioUrl: string }) =>
    mockResolveAudioUri(word),
}));

import Escucha from "../escucha";
import { setDbDouble } from "../../../test/doubles/db-context";

/** 4 palabras con audio: el mínimo que exige el juego (`MIN = 4`). */
const WORDS_WITH_AUDIO = [
  makeWord({ id: "a1", spanish: "agua", nasaYuwe: "mü", audioUrl: "https://cdn.test/a1.mp3" }),
  makeWord({ id: "a2", spanish: "casa", nasaYuwe: "tsa", audioUrl: "https://cdn.test/a2.mp3" }),
  makeWord({ id: "a3", spanish: "luna", nasaYuwe: "ki", audioUrl: "https://cdn.test/a3.mp3" }),
  makeWord({ id: "a4", spanish: "sol", nasaYuwe: "mi", audioUrl: "https://cdn.test/a4.mp3" }),
];

/**
 * Con `Math.random` fijo el Fisher-Yates de la pantalla es la identidad:
 * las rondas salen en el orden alfabético del store y las opciones en el
 * mismo orden. Así el test sabe cuál es la respuesta correcta.
 */
const RANDOM_FIJO = 0.999999;

/**
 * Pantalla Escucha (feature entregada al cliente): carga de palabras con
 * audio, slots de altura reservada para que validar nunca requiera scroll y
 * layout en dos columnas cuando la pantalla está en horizontal.
 */
describe("Escucha (pantalla)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    const store = new MemoryWordStore();
    await store.upsertWords(WORDS_WITH_AUDIO);
    setDbDouble({ store });
    mockUseWindowDimensions.mockReturnValue({
      width: 390,
      height: 844,
      scale: 3,
      fontScale: 1,
    });
    jest.spyOn(Math, "random").mockReturnValue(RANDOM_FIJO);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("muestra el estado de preparación mientras no hay diccionario", () => {
    setDbDouble({ store: null });
    render(<Escucha />);
    expect(screen.getByText("Preparando diccionario...")).toBeTruthy();
  });

  it("exige al menos 4 palabras con audio publicado", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({ id: "a1", spanish: "agua", nasaYuwe: "mü", audioUrl: "https://cdn.test/a1.mp3" }),
      makeWord({ id: "a2", spanish: "casa", nasaYuwe: "tsa", audioUrl: "https://cdn.test/a2.mp3" }),
      makeWord({ id: "a3", spanish: "luna", nasaYuwe: "ki", audioUrl: "https://cdn.test/a3.mp3" }),
    ]);
    setDbDouble({ store });

    render(<Escucha />);

    expect(await screen.findByText("Requiere audios")).toBeTruthy();
    expect(
      screen.getByText("Necesita al menos 4 palabras con audio publicado.")
    ).toBeTruthy();
  });

  it("arma la primera ronda con cuatro opciones", async () => {
    render(<Escucha />);

    expect(await screen.findByText("Escucha")).toBeTruthy();
    expect(screen.getByText("Ronda 1 / 4")).toBeTruthy();
    expect(screen.getByText("Aciertos: 0")).toBeTruthy();
    for (const w of WORDS_WITH_AUDIO) {
      expect(screen.getByRole("button", { name: w.spanish })).toBeTruthy();
    }
  });

  it("revela la palabra en Nasa Yuwe y habilita Siguiente al acertar", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "agua" }));

    expect(screen.getByText("✓ Correcto")).toBeTruthy();
    expect(screen.getByText("mü")).toBeTruthy();
    expect(screen.getByText("Aciertos: 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeTruthy();
  });

  it("marca incorrecto sin sumar aciertos", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "casa" }));

    expect(screen.getByText("✗ Incorrecto")).toBeTruthy();
    expect(screen.getByText("Aciertos: 0")).toBeTruthy();
  });

  it("reserva altura fija para el revelado y para el botón Siguiente", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    // El slot de revelado está montado desde el inicio (placeholder): al
    // validar solo se rellena el espacio, la página no crece.
    expect(screen.getByText("···")).toBeTruthy();

    const styles = renderedStyles();
    expect(styles.filter((s) => s.minHeight === 148)).toHaveLength(1);
    expect(styles.filter((s) => s.height === 52)).toHaveLength(1);
  });

  it("reparte las opciones en dos columnas cuando la pantalla está en horizontal", async () => {
    mockUseWindowDimensions.mockReturnValue({
      width: 844,
      height: 390,
      scale: 3,
      fontScale: 1,
    });

    render(<Escucha />);
    await screen.findByText("Escucha");

    const styles = renderedStyles();
    // Grilla de opciones (fila + wrap) y botones al 48% del ancho.
    expect(
      styles.some((s) => s.flexDirection === "row" && s.flexWrap === "wrap")
    ).toBe(true);
    expect(styles.filter((s) => s.width === "48%")).toHaveLength(4);
  });

  it("reproduce el audio de la ronda y queda en estado reproduciendo", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Reproducir audio" }));

    expect(await screen.findByRole("button", { name: "Reproduciendo..." })).toBeTruthy();
    expect(mockResolveAudioUri).toHaveBeenCalledWith({
      id: "a1",
      audioUrl: "https://cdn.test/a1.mp3",
    });
    expect(mockAudioPlayer.load).toHaveBeenCalledWith(
      "https://cdn.test/a1.mp3",
      expect.any(Function)
    );
    expect(mockAudioPlayer.play).toHaveBeenCalled();
  });

  it("termina las rondas y muestra el puntaje final", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    const user = userEvent.setup();
    for (const round of ["agua", "casa", "luna", "sol"]) {
      await user.press(screen.getByRole("button", { name: round }));
      await user.press(screen.getByRole("button", { name: "Siguiente" }));
    }

    expect(await screen.findByText("¡Terminado!")).toBeTruthy();
    expect(screen.getByText("4 / 4 aciertos")).toBeTruthy();
  });

  it("el botón Reintentar reinicia la ronda y el puntaje", async () => {
    render(<Escucha />);
    await screen.findByText("Escucha");

    const user = userEvent.setup();
    for (const round of ["agua", "casa", "luna", "sol"]) {
      await user.press(screen.getByRole("button", { name: round }));
      await user.press(screen.getByRole("button", { name: "Siguiente" }));
    }
    await screen.findByText("¡Terminado!");

    await user.press(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Ronda 1 / 4")).toBeTruthy();
    expect(screen.getByText("Aciertos: 0")).toBeTruthy();
  });
});
