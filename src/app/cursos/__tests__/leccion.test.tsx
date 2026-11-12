import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryWordStore } from "../../../db/memory-store";
import { MemoryCourseStore } from "../../../db/course-store";
import type { CourseStore } from "../../../db/course-store";
import type { LessonRow } from "../../../db/course-types";
import { makeWord } from "../../../test/fixtures/words";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/**
 * El doble compartido de `db-context` no expone `courseStore` (su tipo es
 * `null`), pero la pantalla de lección lo necesita: se lo sumamos encima
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

/** La ruta de la lección: `/cursos/leccion/[id]`. */
const mockParams: { id?: string } = { id: "l1" };
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
  usePathname: () => "/cursos/leccion/[id]",
  useSegments: () => [],
}));

import Leccion from "../leccion/[id]";
import { setDbDouble } from "../../../test/doubles/db-context";

function leccion(id: string, title: string, content: unknown): LessonRow {
  return {
    id,
    moduleId: "m1",
    title,
    order: 0,
    lessonNumber: "1",
    content: JSON.stringify(content),
  };
}

/** Monta la pantalla y deja que los efectos asíncronos se resuelvan. */
async function montarLeccion() {
  render(<Leccion />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Pantalla Lección: contenido de la lección, palabras del vocabulario,
 * completado y navegación entre lecciones.
 */
describe("Lección (pantalla)", () => {
  let courseStore: MemoryCourseStore;
  let wordStore: MemoryWordStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockParams.id = "l1";

    wordStore = new MemoryWordStore();
    await wordStore.upsertWords([
      makeWord({ id: "w1", spanish: "casa", nasaYuwe: "tsa", category: "hogar" }),
      makeWord({ id: "w2", spanish: "agua", nasaYuwe: "mü", category: "agua" }),
    ]);

    courseStore = new MemoryCourseStore();
    await courseStore.upsertCourse({
      id: "c1",
      title: "Curso de saludos",
      description: null,
      status: "PUBLISHED",
      coverImage: null,
      sequential: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await courseStore.upsertModule({
      id: "m1",
      courseId: "c1",
      title: "Módulo 1",
      order: 0,
      lessons: [],
    });
    await courseStore.upsertLesson(
      leccion("l1", "Saludos básicos", {
        version: 2,
        blocks: [
          { id: "b1", type: "text", html: "<p>Hola en Nasa Yuwe</p>" },
          { id: "b2", type: "vocabulary", wordIds: ["w1", "w2"] },
        ],
      })
    );
    await courseStore.upsertLesson(
      leccion("l2", "Presentaciones", { version: 2, blocks: [] })
    );

    mockCourseStore.current = courseStore;
    setDbDouble({ store: wordStore });
  });

  it("muestra el estado de carga mientras busca la lección", () => {
    mockCourseStore.current = null;
    render(<Leccion />);
    expect(screen.getByText("Cargando lección...")).toBeTruthy();
  });

  it("muestra el título y el contenido de la lección", async () => {
    await montarLeccion();

    expect(await screen.findByText("Saludos básicos")).toBeTruthy();
    expect(screen.getByText("Hola en Nasa Yuwe")).toBeTruthy();
    expect(screen.getByText("Módulo 1 · Lección 1")).toBeTruthy();
  });

  it("muestra las palabras del vocabulario de la lección", async () => {
    await montarLeccion();

    expect(await screen.findByText("Saludos básicos")).toBeTruthy();
    expect(screen.getByText("tsa")).toBeTruthy();
    expect(screen.getByText("mü")).toBeTruthy();
  });

  it("avisa cuando una palabra del vocabulario no está descargada", async () => {
    await courseStore.upsertLesson(
      leccion("l1", "Saludos básicos", {
        version: 2,
        blocks: [{ id: "b3", type: "word", wordId: "w99" }],
      })
    );

    await montarLeccion();

    expect(await screen.findByText("Palabra no disponible")).toBeTruthy();
  });

  it("permite marcar la lección como completada", async () => {
    const setProgress = jest.spyOn(courseStore, "setProgress");

    await montarLeccion();
    await screen.findByText("Saludos básicos");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Marcar como completada" }));

    expect(setProgress).toHaveBeenCalledWith("l1", true, null);
  });

  it("muestra la lección como completada cuando ya tiene progreso", async () => {
    await courseStore.setProgress("l1", true, 100);

    await montarLeccion();

    expect(await screen.findByRole("button", { name: "Completada" })).toBeTruthy();
  });

  it("navega a la lección siguiente", async () => {
    await montarLeccion();
    await screen.findByText("Saludos básicos");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Siguiente" }));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/cursos/leccion/[id]",
      params: { id: "l2" },
    });
  });

  it("deshabilita la navegación hacia atrás en la primera lección", async () => {
    await montarLeccion();
    await screen.findByText("Saludos básicos");

    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
  });
});
