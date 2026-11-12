import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

jest.mock("../../auth", () => require("../../test/doubles/auth").authDouble);

import Ajustes from "../ajustes";
import { setDbDouble } from "../../test/doubles/db-context";

/**
 * Pantalla Ajustes: estado de la sincronización, conteo local, pendientes
 * del outbox y feedback explícito de éxito o error.
 */
describe("Ajustes (pantalla)", () => {
  let store: MemoryWordStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    store = new MemoryWordStore();
    await store.upsertWords([
      makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
      makeWord({ id: "w3", spanish: "sol", nasaYuwe: "mi", category: "cielo" }),
    ]);
  });

  it("muestra el estado de la sincronización y el conteo local", async () => {
    setDbDouble({ store });

    render(<Ajustes />);

    expect(await screen.findByText("Al día")).toBeTruthy();
    expect(screen.getByText("Última sincronización")).toBeTruthy();
    expect(screen.getByText("nunca")).toBeTruthy();
    expect(screen.getByText("Palabras locales")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Cambios pendientes")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("muestra el progreso mientras la sincronización está en curso", async () => {
    setDbDouble({
      store,
      syncing: true,
      syncProgress: { done: 1, total: 4 },
    });

    render(<Ajustes />);

    expect(await screen.findByText("Sincronizando…")).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy();
  });

  it("el botón Sincronizar ahora avisa que terminó bien", async () => {
    setDbDouble({ store });

    render(<Ajustes />);
    await screen.findByText("Al día");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Sincronizar ahora" }));

    expect(await screen.findByText("Sincronización completa.")).toBeTruthy();
  });

  it("el botón Sincronizar ahora avisa cuando falla", async () => {
    const db = setDbDouble({ store });
    db.sync.mockRejectedValue(new Error("sin red"));

    render(<Ajustes />);
    await screen.findByText("Al día");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Sincronizar ahora" }));

    expect(
      await screen.findByText(
        "No se pudo sincronizar. Revisá tu conexión e intentá de nuevo."
      )
    ).toBeTruthy();
  });

  it("envía los cambios pendientes y avisa que salieron", async () => {
    setDbDouble({ store, pendingOutboxCount: 2 });

    render(<Ajustes />);
    await screen.findByText("Al día");

    const user = userEvent.setup();
    await user.press(
      screen.getByRole("button", { name: "Enviar cambios pendientes (2)" })
    );

    expect(await screen.findByText("Cambios enviados al servidor.")).toBeTruthy();
  });

  it("no ofrece enviar cambios cuando no hay pendientes", async () => {
    setDbDouble({ store, pendingOutboxCount: 0 });

    render(<Ajustes />);
    await screen.findByText("Al día");

    expect(
      screen.queryByRole("button", { name: /Enviar cambios pendientes/ })
    ).toBeNull();
  });
});
