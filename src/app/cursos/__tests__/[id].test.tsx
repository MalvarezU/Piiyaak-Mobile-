import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, userEvent, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { MemoryCourseStore } from "../../../db/course-store";
import type { CourseStore } from "../../../db/course-store";
import { mockLucide } from "../../__tests__/_test-utils";

jest.mock("lucide-react-native", () => mockLucide);

/**
 * El doble compartido de `db-context` no expone `courseStore` (su tipo es
 * `null`), pero la pantalla de detalle lo necesita: se lo sumamos encima
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

/** La ruta del detalle: `/cursos/[id]`. */
const mockParams: { id?: string } = { id: "c1" };
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
  usePathname: () => "/cursos/[id]",
  useSegments: () => [],
  // `useFocusEffect` no viene en el mock global de `jest.setup.tsx`.
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => effect(), [effect]);
  },
}));

import CursoDetail from "../[id]";
import { setDbDouble } from "../../../test/doubles/db-context";

// Las pantallas RN con cobertura de istanbul corren más lento: margen para el timeout por test.
jest.setTimeout(30_000);

/** Monta la pantalla y deja que los efectos asíncronos se resuelvan. */
async function montarDetalle() {
  render(<CursoDetail />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Detalle de curso: módulos, lecciones, progreso, bloqueo secuencial y
 * celebración al completar el curso.
 */
describe("Curso (detalle)", () => {
  let courseStore: MemoryCourseStore;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockParams.id = "c1";
    courseStore = new MemoryCourseStore();
    await courseStore.upsertCourse({
      id: "c1",
      title: "Curso de saludos",
      description: "Aprende a saludar en Nasa Yuwe",
      status: "PUBLISHED",
      coverImage: null,
      sequential: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await courseStore.upsertModule({
      id: "m1",
      courseId: "c1",
      title: "Módulo 1 · Saludos",
      order: 0,
      lessons: [],
    });
    await courseStore.upsertLesson({
      id: "l1",
      moduleId: "m1",
      title: "Hola",
      order: 0,
      lessonNumber: "1",
      content: "{}",
    });
    await courseStore.upsertLesson({
      id: "l2",
      moduleId: "m1",
      title: "Buenos días",
      order: 1,
      lessonNumber: "2",
      content: "{}",
    });
    mockCourseStore.current = courseStore;
    setDbDouble({ store: null });
  });

  it("muestra el estado de carga mientras busca el curso", () => {
    mockCourseStore.current = null;
    render(<CursoDetail />);
    expect(screen.getByText("Cargando curso...")).toBeTruthy();
  });

  it("muestra el curso con sus módulos y lecciones", async () => {
    await montarDetalle();

    expect(await screen.findByText("Curso de saludos")).toBeTruthy();
    expect(screen.getByText("Aprende a saludar en Nasa Yuwe")).toBeTruthy();
    expect(screen.getByText("Módulo 1 · Saludos")).toBeTruthy();
    expect(screen.getByText("Hola")).toBeTruthy();
    expect(screen.getByText("Buenos días")).toBeTruthy();
    expect(screen.getByText("0 de 2 lecciones · 0%")).toBeTruthy();
  });

  it("refleja el progreso de las lecciones completadas", async () => {
    await courseStore.setProgress("l1", true, 100);

    await montarDetalle();

    expect(await screen.findByText("1 de 2 lecciones · 50%")).toBeTruthy();
  });

  it("abre la lección al tocarla", async () => {
    await montarDetalle();
    await screen.findByText("Hola");

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Hola" }));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/cursos/leccion/[id]",
      params: { id: "l1" },
    });
  });

  it("bloquea las lecciones siguientes de un curso secuencial", async () => {
    await courseStore.upsertCourse({
      id: "c1",
      title: "Curso de saludos",
      description: "Aprende a saludar en Nasa Yuwe",
      status: "PUBLISHED",
      coverImage: null,
      sequential: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await montarDetalle();

    // Una lección bloqueada no es un elemento accesible: se busca por label.
    expect(await screen.findByLabelText("Buenos días")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hola" })).toBeEnabled();
  });

  it("celebra el curso cuando todas las lecciones están completas", async () => {
    await courseStore.setProgress("l1", true, 100);
    await courseStore.setProgress("l2", true, 100);

    await montarDetalle();

    expect(await screen.findByText("¡Curso completado!")).toBeTruthy();
    expect(
      screen.getByText("Completaste todas las lecciones de Curso de saludos")
    ).toBeTruthy();
  });
});
