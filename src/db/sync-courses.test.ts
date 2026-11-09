import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncCourses } from "./sync-courses";
import { MemoryCourseStore } from "./course-store";
import type { SessionState } from "../api";

const session: SessionState = {
  cookie: "next-auth.session-token=abc",
  user: { id: "u1", email: "a@b.com", name: null, role: "user" },
};

function courseRow(id: string, title = `Curso ${id}`) {
  return {
    id,
    title,
    description: null,
    status: "PUBLISHED",
    coverImage: null,
    sequential: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function modRow(id: string, courseId: string) {
  return { id, courseId, title: `Mod ${id}`, order: 0, lessons: [] };
}

function lessonRow(id: string, moduleId: string) {
  return {
    id,
    moduleId,
    title: `Lesson ${id}`,
    order: 0,
    lessonNumber: null,
    content: JSON.stringify({ version: 2, blocks: [] }),
  };
}

function detailResponse(modules: Array<{ id: string; lessons: string[] }>) {
  return {
    course: {
      modules: modules.map((m, i) => ({
        id: m.id,
        title: `Mod ${m.id}`,
        order: i,
        lessons: m.lessons.map((l, j) => ({
          id: l,
          title: `Lesson ${l}`,
          order: j,
          lessonNumber: j + 1,
          content: { version: 2, blocks: [] },
        })),
      })),
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncCourses atómico (B2, opción U)", () => {
  it("fallo inyectado a mitad conserva el contenido previo intacto", async () => {
    const store = new MemoryCourseStore();
    await store.upsertCourse(courseRow("c1"));
    await store.upsertModule(modRow("m1", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.setProgress("l1", true, 100);

    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null, modules: 1, lessons: 1, progressPct: null },
              { id: "c2", title: "C2", description: null, status: "PUBLISHED", coverImage: null, modules: 1, lessons: 1, progressPct: null },
            ],
          }),
        } as unknown as Response;
      }
      if (typeof url === "string" && url.endsWith("/api/courses/c1")) {
        return {
          ok: true,
          status: 200,
          json: async () => detailResponse([{ id: "m1", lessons: ["l1"] }]),
        } as unknown as Response;
      }
      // Corte de red en el detalle del segundo curso.
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncCourses(store, session)).rejects.toThrow("network down");

    // Contenido previo idéntico: conteo y muestra sin cambios.
    expect(await store.getCourse("c1")).toMatchObject({ id: "c1", title: "Curso c1" });
    expect(await store.getModules("c1")).toHaveLength(1);
    expect(await store.getLessons("m1")).toHaveLength(1);
    expect(await store.getLesson("l1")).toMatchObject({ id: "l1" });
    expect(await store.getProgress("l1")).toMatchObject({ completed: true });
    expect(await store.getCourse("c2")).toBeNull();
  });

  it("reconcilia bajas dentro de la transacción, incluido progreso huérfano", async () => {
    const store = new MemoryCourseStore();
    // Local: c1 (vigente) + c-old (dado de baja en remoto) con progreso.
    await store.upsertCourse(courseRow("c1"));
    await store.upsertModule(modRow("m1", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.setProgress("l1", true, 100);
    await store.upsertCourse(courseRow("c-old"));
    await store.upsertModule(modRow("m-old", "c-old"));
    await store.upsertLesson(lessonRow("l-old", "m-old"));
    await store.setProgress("l-old", true, 80);
    // Huérfano preexistente: progreso de lección que ya no existe.
    await store.setProgress("l-ghost", false, null);

    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1 nuevo", description: null, status: "PUBLISHED", coverImage: null, modules: 1, lessons: 2, progressPct: null },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => detailResponse([{ id: "m1", lessons: ["l1", "l2"] }]),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await syncCourses(store, session);
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 2 });

    // c1 actualizado in place, progreso de l1 preservado.
    expect(await store.getCourse("c1")).toMatchObject({ title: "C1 nuevo" });
    expect(await store.getProgress("l1")).toMatchObject({ completed: true });
    expect(await store.getLesson("l2")).not.toBeNull();
    // Baja reconciliada con su progreso.
    expect(await store.getCourse("c-old")).toBeNull();
    expect(await store.getModules("c-old")).toEqual([]);
    expect(await store.getLessons("m-old")).toEqual([]);
    expect(await store.getProgress("l-old")).toBeNull();
    // Huérfano preexistente barrido.
    expect(await store.getProgress("l-ghost")).toBeNull();
    expect(await store.listCourseIds()).toEqual(["c1"]);
  });

  it("upsert idempotente: doble sync deja el mismo contenido sin duplicados", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null, modules: 1, lessons: 1, progressPct: null },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => detailResponse([{ id: "m1", lessons: ["l1"] }]),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryCourseStore();
    const first = await syncCourses(store, session);
    await store.setProgress("l1", true, 100);
    const second = await syncCourses(store, session);
    expect(second).toEqual(first);
    expect(await store.listCourseIds()).toEqual(["c1"]);
    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
    // El progreso local sobrevive a la re-sync (no es contenido remoto).
    expect(await store.getProgress("l1")).toMatchObject({ completed: true });
  });
});
