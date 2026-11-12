import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryWordStore } from "../../../db/memory-store";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

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
  usePathname: () => "/juegos",
  useSegments: () => [],
}));

jest.mock("../../../db-context", () =>
  require("../../../test/doubles/db-context").dbContextDouble
);

import JuegosHub from "../index";
import { setDbDouble } from "../../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/** Palabra con audio publicado: es lo que habilita el juego Escucha. */
function palabraConAudio(id: string): ReturnType<typeof makeWord> {
  return makeWord({
    id,
    spanish: `palabra ${id}`,
    nasaYuwe: `ny-${id}`,
    category: "prueba",
    audioUrl: `https://cdn.test/${id}.mp3`,
  });
}

/**
 * Hub de Juegos: listado de juegos y bloqueo de Escucha mientras no haya
 * suficientes palabras con audio.
 */
describe("Juegos (hub)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lista los juegos disponibles", async () => {
    const store = new MemoryWordStore();
    setDbDouble({ store });

    render(<JuegosHub />);

    expect(await screen.findByText("Flashcards")).toBeTruthy();
    expect(screen.getByText("Relaciona")).toBeTruthy();
    expect(screen.getByText("Completar")).toBeTruthy();
    expect(screen.getByText("Ordena")).toBeTruthy();
    expect(screen.getByText("Escucha")).toBeTruthy();
  });

  it("bloquea Escucha cuando no hay suficientes palabras con audio", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords([palabraConAudio("a1")]);
    setDbDouble({ store });

    render(<JuegosHub />);

    expect(await screen.findByText("Requiere audios")).toBeTruthy();
    expect(
      screen.getByText("Necesita al menos 4 palabras con audio publicado.")
    ).toBeTruthy();
  });

  it("habilita Escucha cuando hay 4 palabras con audio", async () => {
    const store = new MemoryWordStore();
    await store.upsertWords(
      Array.from({ length: 4 }, (_, i) => palabraConAudio(`a${i}`))
    );
    setDbDouble({ store });

    render(<JuegosHub />);

    expect(await screen.findByText("Escucha")).toBeTruthy();
    expect(screen.queryByText("Requiere audios")).toBeNull();
  });

  it("abre el juego al tocar su tarjeta", async () => {
    const store = new MemoryWordStore();
    setDbDouble({ store });

    render(<JuegosHub />);
    await screen.findByText("Flashcards");

    const user = userEvent.setup();
    await user.press(screen.getByLabelText("Flashcards"));

    expect(mockRouter.push).toHaveBeenCalledWith("/juegos/flashcards");
  });
});
