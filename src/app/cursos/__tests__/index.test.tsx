import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryCourseStore } from "../../../db/course-store";
import type { CourseStore } from "../../../db/course-store";
import type { CourseRow } from "../../../db/course-types";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/**
 * El doble compartido de `db-context` no expone `courseStore` (su tipo es
 * `null`), pero las pantallas de cursos lo necesitan: se lo sumamos encima
 * del doble en vez de reescribirlo.
 */
const mockCourseStore: { current: CourseStore | null } = { current: null };
jest.mock("../../../db-context", () => {
  const doubles = require("../../../test/doubles/db-context");
  return {
    __esModule: true,
    useDb: () => ({
      ...doubles.dbContextDouble.useDb(),
      courseStore: mockCourseStore.current,
    }),
  };
});

jest.mock("../../../auth", () =>
  require("../../../test/doubles/auth").authDouble
);

/** La sincronización de cursos pega al backend: en tests es un doble. */
const mockSyncCourses = jest.fn(
  async (
    _store: unknown,
    _session: unknown
  ): Promise<{ courses: number; modules: number; lessons: number }> => ({
    courses: 0,
    modules: 0,
    lessons: 0,
  })
);
const mockFlushCourseProgress = jest.fn(
  async (
    _courseStore: unknown,
    _wordStore: unknown,
    _session: unknown
  ): Promise<void> => undefined
);
jest.mock("../../../db/sync-courses", () => ({
  syncCourses: (store: unknown, session: unknown) =>
    mockSyncCourses(store, session),
  flushCourseProgress: (
    courseStore: unknown,
    wordStore: unknown,
    session: unknown
  ) => mockFlushCourseProgress(courseStore, wordStore, session),
}));

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
  usePathname: () => "/cursos",
  useSegments: () => [],
}));

import Cursos from "../index";
import { setDbDouble } from "../../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/**
 * `MemoryCourseStore` no calcula `progressPct` (lo calcula el store SQLite),
 * así que esta subclase lo agrega para poder ejercitar la banda de
 * "retomar donde quedaste".
 */
class CourseStoreConProgreso extends MemoryCourseStore {
  override async getCourses(): Promise<CourseRow[]> {
    const cursos = await super.getCourses();
    return cursos.map((c) => ({
      ...c,
      progressPct: c.id === "c1" ? 50 : null,
    }));
  }
}

function curso(id: string, title: string, description: string): CourseRow {
  return {
    id,
    title,
    description,
    status: "PUBLISHED",
    coverImage: null,
    sequential: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Monta la pantalla y deja que los efectos asíncronos (carga del catálogo y
 * sincronización) se resuelvan dentro de `act`.
 */
async function montarCursos() {
  render(<Cursos />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Pantalla Cursos: catálogo descargado, portada destacada, buscador por
 * título y sincronización con feedback de error.
 */
describe("Cursos (pantalla)", () => {
  let courseStore: MemoryCourseStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    courseStore = new MemoryCourseStore();
    mockCourseStore.current = courseStore;
    mockSyncCourses.mockImplementation(async () => ({
      courses: 0,
      modules: 0,
      lessons: 0,
    }));
    setDbDouble({ store: null });
  });

  it("muestra el estado vacío cuando no hay cursos descargados", async () => {
    await montarCursos();

    expect(
      await screen.findByText("Sin cursos. Sincroniza para descargar.")
    ).toBeTruthy();
  });

  it("lista los cursos publicados del catálogo", async () => {
    await courseStore.upsertCourse(curso("c1", "Primer curso", "Aprende a saludar"));
    await courseStore.upsertCourse(curso("c2", "Segundo curso", "Aprende ayms"));

    await montarCursos();

    expect(await screen.findByText("Primer curso")).toBeTruthy();
    expect(screen.getByText("Segundo curso")).toBeTruthy();
    expect(screen.getByText("Aprende a saludar")).toBeTruthy();
  });

  it("filtra el catálogo con el buscador", async () => {
    await courseStore.upsertCourse(curso("c1", "Curso del agua", ""));
    await courseStore.upsertCourse(curso("c2", "Curso de la casa", ""));

    await montarCursos();
    await screen.findByText("Curso del agua");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar cursos"), "casa");

    expect(await screen.findByText("Curso de la casa")).toBeTruthy();
    expect(screen.queryByText("Curso del agua")).toBeNull();
  });

  it("el botón Sincronizar cursos dispara la sincronización", async () => {
    await montarCursos();
    await screen.findByText("Sincronizar cursos");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Sincronizar cursos" }));

    expect(mockSyncCourses).toHaveBeenCalled();
  });

  it("muestra el error cuando la sincronización falla", async () => {
    mockSyncCourses.mockRejectedValue(new Error("sin red"));

    await montarCursos();

    expect(
      await screen.findByText(
        "No se pudo sincronizar. Revisá la conexión e intentá de nuevo."
      )
    ).toBeTruthy();
  });

  it("muestra la banda de continuar donde quedaste", async () => {
    const storeConProgreso = new CourseStoreConProgreso();
    await storeConProgreso.upsertCourse(curso("c1", "Primer curso", ""));
    await storeConProgreso.upsertModule({
      id: "m1",
      courseId: "c1",
      title: "Módulo 1",
      order: 0,
      lessons: [],
    });
    await storeConProgreso.upsertLesson({
      id: "l1",
      moduleId: "m1",
      title: "Primera lección",
      order: 0,
      lessonNumber: "1",
      content: "{}",
    });
    mockCourseStore.current = storeConProgreso;

    await montarCursos();

    expect(await screen.findByText("RETOMAR CURSO")).toBeTruthy();
    // La banda y la portada destacada muestran el mismo avance.
    expect(screen.getAllByText("50% completado").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
  });

  it("retoma la lección pendiente desde la banda", async () => {
    const storeConProgreso = new CourseStoreConProgreso();
    await storeConProgreso.upsertCourse(curso("c1", "Primer curso", ""));
    await storeConProgreso.upsertModule({
      id: "m1",
      courseId: "c1",
      title: "Módulo 1",
      order: 0,
      lessons: [],
    });
    await storeConProgreso.upsertLesson({
      id: "l1",
      moduleId: "m1",
      title: "Primera lección",
      order: 0,
      lessonNumber: "1",
      content: "{}",
    });
    mockCourseStore.current = storeConProgreso;

    await montarCursos();
    await screen.findByText("RETOMAR CURSO");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Continuar" }));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/cursos/leccion/[id]",
      params: { id: "l1" },
    });
  });

  it("el botón de limpiar búsqueda vacía el buscador", async () => {
    await courseStore.upsertCourse(curso("c1", "Curso del agua", ""));

    await montarCursos();
    await screen.findByText("Curso del agua");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar cursos"), "agua");
    await user.press(screen.getByLabelText("Limpiar búsqueda"));

    expect(screen.getByLabelText("Buscar cursos").props.value).toBe("");
  });

  it("avisa el error cuando falla la sincronización manual", async () => {
    // El auto-sync al entrar sí funciona; el botón falla.
    mockSyncCourses
      .mockImplementationOnce(async () => ({ courses: 0, modules: 0, lessons: 0 }))
      .mockRejectedValue(new Error("sin red"));

    await montarCursos();
    await screen.findByText("Sincronizar cursos");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Sincronizar cursos" }));

    expect(
      await screen.findByText(
        "No se pudo sincronizar. Revisá la conexión e intentá de nuevo."
      )
    ).toBeTruthy();
  });

  it("abre el detalle del curso tocado", async () => {
    await courseStore.upsertCourse(curso("c1", "Primer curso", ""));

    await montarCursos();
    await screen.findByText("Primer curso");

    const user = userEvent.setup();
    await user.press(screen.getByLabelText("Primer curso"));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/cursos/[id]",
      params: { id: "c1" },
    });
  });
});
