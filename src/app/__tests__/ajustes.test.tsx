import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { MemoryWordStore } from "../../db/memory-store";
import { makeWord } from "../../test/fixtures/words";
import { mockLucide } from "./_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

jest.mock("../../db-context", () =>
  require("../../test/doubles/db-context").dbContextDouble
);

/**
 * El flag de UI de autenticación va detrás de un getter para poder probar
 * las dos ramas (activado/desactivado) en el mismo archivo.
 */
const mockAuthUiEnabled = { value: false };
jest.mock("../../auth", () => {
  const doubles = require("../../test/doubles/auth");
  return {
    __esModule: true,
    useAuth: doubles.authDouble.useAuth,
    get AUTH_UI_ENABLED() {
      return mockAuthUiEnabled.value;
    },
  };
});

import Ajustes from "../ajustes";
import { setDbDouble } from "../../test/doubles/db-context";
import { setAuthDouble } from "../../test/doubles/auth";
import type { SessionState as SessionStateDouble } from "../../test/doubles/auth";
import type { SessionState as SessionStateApi } from "../../api";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/**
 * Pantalla Ajustes: estado de la sincronización, conteo local, pendientes
 * del outbox y feedback explícito de éxito o error.
 */
describe("Ajustes (pantalla)", () => {
  let store: MemoryWordStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthUiEnabled.value = false;
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
    // El conteo local se resuelve contra el store: es asíncrono.
    expect(await screen.findByText("3")).toBeTruthy();
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

  it("muestra la última sincronización como tiempo relativo", async () => {
    const hace5min = new Date(Date.now() - 5 * 60_000).toISOString();
    setDbDouble({ store, lastSync: hace5min });

    render(<Ajustes />);

    expect(await screen.findByText("hace 5 min")).toBeTruthy();
  });

  it("no muestra la sección de cuenta con la UI de autenticación deshabilitada", async () => {
    setDbDouble({ store });

    render(<Ajustes />);
    await screen.findByText("Al día");

    expect(screen.queryByText("Cuenta")).toBeNull();
    expect(screen.queryByPlaceholderText("Correo")).toBeNull();
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

/**
 * Con la UI de autenticación habilitada (flag `AUTH_UI_ENABLED`), Ajustes
 * muestra además el bloque de cuenta: entrar, error de login y sesión activa.
 */
describe("Ajustes con la UI de cuenta habilitada", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthUiEnabled.value = true;
    const store = new MemoryWordStore();
    await store.upsertWords([makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa" })]);
    setDbDouble({ store });
  });

  it("muestra el formulario de entrada cuando no hay sesión", async () => {
    render(<Ajustes />);

    expect(await screen.findByText("Cuenta")).toBeTruthy();
    expect(screen.getByPlaceholderText("Correo")).toBeTruthy();
    expect(screen.getByPlaceholderText("Contraseña")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
  });

  it("avisa el error cuando el login falla", async () => {
    const auth = setAuthDouble({ session: null });
    // El doble tipa `login` como `Promise<void>`, pero producción devuelve
    // `Promise<boolean>` (el booleano decide si se muestra el error).
    const login = auth.login as unknown as jest.Mock<
      (email: string, password: string) => Promise<boolean>
    >;
    login.mockResolvedValue(false);

    render(<Ajustes />);
    await screen.findByText("Cuenta");

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Correo"), "ana@piiyaak.app");
    await user.type(screen.getByPlaceholderText("Contraseña"), "mala");
    await user.press(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText(/No se pudo entrar/)
    ).toBeTruthy();
  });

  it("muestra la sesión activa y permite cerrar sesión", async () => {
    // La pantalla usa la forma de sesión de producción (`api.SessionState`:
    // `{ cookie, user }`), que no es la que declara el doble de auth
    // (`{ token, email }`). Se pasa la forma real con un cast explícito.
    const sesion: SessionStateApi = {
      cookie: "session=abc",
      user: { id: "u1", email: "ana@piiyaak.app", name: "Ana", role: "user" },
    };
    const auth = setAuthDouble({
      session: sesion as unknown as SessionStateDouble,
    });

    render(<Ajustes />);
    await screen.findByText("ana@piiyaak.app");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(auth.logout).toHaveBeenCalledTimes(1);
  });
});
