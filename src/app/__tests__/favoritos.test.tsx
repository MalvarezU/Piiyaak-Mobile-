import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../db/memory-store";
import { WORDS } from "../../test/fixtures/words";

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

import Favoritos from "../favoritos";
import { setDbDouble, type DbDouble } from "../../test/doubles/db-context";

/**
 * Pantalla Favoritos: lista de favoritas con estado vacío, carga asíncrona
 * desde el store y des-favoritado con long press.
 */
describe("Favoritos (pantalla)", () => {
  let db: DbDouble;

  beforeEach(async () => {
    const store = new MemoryWordStore();
    await store.upsertWords(WORDS);
    db = setDbDouble({ store, favorites: ["w1"] });
  });

  it("muestra el estado vacío cuando no hay favoritas", () => {
    setDbDouble({ store: new MemoryWordStore(), favorites: [] });
    render(<Favoritos />);
    expect(screen.getByText(/Sin favoritas/)).toBeTruthy();
  });

  it("lista las palabras favoritas desde el store", async () => {
    render(<Favoritos />);

    // La carga desde el store es asíncrona (useEffect).
    expect(await screen.findByText("casa")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    // Solo la favorita: "agua" no debe aparecer.
    expect(screen.queryByText("agua")).toBeNull();
  });

  it("quita el favorito con long press", async () => {
    render(<Favoritos />);
    await screen.findByText("casa");

    const user = userEvent.setup();
    await user.longPress(screen.getByText("casa"));

    expect(db.toggleFavorite).toHaveBeenCalledTimes(1);
    expect(db.toggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ id: "w1", spanish: "casa" })
    );
  });
});
