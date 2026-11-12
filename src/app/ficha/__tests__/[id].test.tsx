import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/** La ruta de la ficha: `/ficha/[id]`. */
const mockParams: { id?: string } = { id: "w1" };
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
  useLocalSearchParams: () => mockParams,
  useGlobalSearchParams: () => ({}),
  usePathname: () => "/ficha/[id]",
  useSegments: () => [],
}));

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

/** Reproductor de audio doble: lo que el test afirma son las llamadas. */
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

const mockResolveAudioUri = jest.fn(
  async (word: { id: string; audioUrl: string }) => word.audioUrl
);
jest.mock("../../../audio", () => ({
  resolveAudioUri: (word: { id: string; audioUrl: string }) =>
    mockResolveAudioUri(word),
}));

import Ficha from "../[id]";
import { setDbDouble } from "../../../test/doubles/db-context";

/**
 * Pantalla Ficha: datos de la palabra, favoritos, historial y media offline.
 */
describe("Ficha (pantalla)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams.id = "w1";
  });

  it("muestra el estado de carga mientras busca la palabra", () => {
    setDbDouble({ store: null });
    render(<Ficha />);
    expect(screen.getByText("Cargando ficha...")).toBeTruthy();
  });

  it("muestra la traducción, la pronunciación y la categoría", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({
        id: "w1",
        spanish: "casa",
        nasaYuwe: "tsa",
        pronunciation: "tsa",
        category: "hogar",
      }),
    ]);
    setDbDouble({ store });

    render(<Ficha />);

    expect(await screen.findByText("casa")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    expect(screen.getByText("[tsa]")).toBeTruthy();
    expect(screen.getByText("hogar")).toBeTruthy();
  });

  it("registra la visita en el historial al abrir la ficha", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" })]);
    const db = setDbDouble({ store });

    render(<Ficha />);
    await screen.findByText("casa");

    expect(db.pushHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", spanish: "casa" })
    );
  });

  it("el botón de favorita marca la palabra y refleja el estado", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" })]);
    const db = setDbDouble({ store, favorites: [] });

    render(<Ficha />);
    await screen.findByText("casa");

    expect(screen.getByRole("button", { name: "Guardar en favoritas" })).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Guardar en favoritas" }));

    expect(db.toggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", spanish: "casa" })
    );
  });

  it("muestra la ilustración resuelta por la caché local (media offline)", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({
        id: "w1",
        spanish: "casa",
        nasaYuwe: "tsa",
        category: "hogar",
        illustrationUrl: "https://cdn.test/casa.png",
      }),
    ]);
    setDbDouble({ store });

    render(<Ficha />);
    await screen.findByText("casa");

    const image = await screen.findByLabelText("casa");
    const uri = (image.props.source as { uri: string }).uri;
    // La ilustración no queda apuntando a la URL remota: se resuelve al
    // archivo local del media-cache para poder verse sin conexión.
    expect(uri.startsWith("file://")).toBe(true);
    expect(uri).not.toContain("https://cdn.test");
  });

  it("avisa cuando la palabra no tiene traducción, pronunciación ni categoría", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({
        id: "w1",
        spanish: "casa",
        nasaYuwe: "",
        pronunciation: null,
        category: "",
      }),
    ]);
    setDbDouble({ store });

    render(<Ficha />);
    await screen.findByText("casa");

    expect(screen.getByText("Traducción no disponible aún")).toBeTruthy();
    expect(screen.getByText("Pronunciación no disponible")).toBeTruthy();
    expect(screen.getByText("Categoría desconocida")).toBeTruthy();
  });

  it("reproduce el audio de la palabra", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({
        id: "w1",
        spanish: "casa",
        nasaYuwe: "tsa",
        category: "hogar",
        audioUrl: "https://cdn.test/casa.mp3",
      }),
    ]);
    setDbDouble({ store });

    render(<Ficha />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Reproducir" }));

    expect(mockResolveAudioUri).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "w1",
        audioUrl: "https://cdn.test/casa.mp3",
      })
    );
    expect(mockAudioPlayer.load).toHaveBeenCalledWith(
      "https://cdn.test/casa.mp3",
      expect.any(Function)
    );
    expect(mockAudioPlayer.play).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeTruthy();
  });

  it("no ofrece reproducción cuando la palabra no tiene audio", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" })]);
    setDbDouble({ store });

    render(<Ficha />);
    await screen.findByText("casa");

    expect(screen.queryByRole("button", { name: "Reproducir" })).toBeNull();
  });
});
