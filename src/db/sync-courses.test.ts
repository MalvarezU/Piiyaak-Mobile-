import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncCourses, flushCourseProgress } from "./sync-courses";
import { MemoryCourseStore } from "./course-store";
import { MemoryWordStore } from "./memory-store";
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

/**
 * Ramas de error de la descarga: cualquier fallo ANTES de la transacción
 * deja el store local intacto (B2: nunca se escribe antes de descargar).
 */
describe("syncCourses ante errores del servidor", () => {
  it("lanza courses 401 cuando la lista de cursos no está autorizada", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryCourseStore();
    await expect(syncCourses(store, session)).rejects.toThrow("courses 401");
    // El store no se tocó: la descarga falló antes de la transacción.
    expect(await store.listCourseIds()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lanza course <id> 404 cuando el detalle de un curso no existe", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryCourseStore();
    await expect(syncCourses(store, session)).rejects.toThrow("course c1 404");
    expect(await store.listCourseIds()).toEqual([]);
  });

  it("propaga el error de red de la lista sin tocar el store", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const store = new MemoryCourseStore();
    await expect(syncCourses(store, session)).rejects.toThrow("network down");
    expect(await store.listCourseIds()).toEqual([]);
  });
});

/**
 * Reconciliación de bajas dentro de la misma transacción: módulos y
 * lecciones locales que el remoto ya no publica.
 */
describe("syncCourses reconcilia módulos y lecciones", () => {
  it("elimina el módulo local que el remoto ya no publica", async () => {
    const store = new MemoryCourseStore();
    await store.upsertCourse(courseRow("c1"));
    await store.upsertModule(modRow("m1", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.upsertModule(modRow("m-old", "c1"));
    await store.upsertLesson(lessonRow("l-old", "m-old"));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
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

    const res = await syncCourses(store, session);
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 1 });
    // El módulo dado de baja desaparece con sus lecciones.
    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listLessonIds("m-old")).toEqual([]);
    expect(await store.getLesson("l-old")).toBeNull();
  });

  it("elimina la lección local que el remoto ya no publica", async () => {
    const store = new MemoryCourseStore();
    await store.upsertCourse(courseRow("c1"));
    await store.upsertModule(modRow("m1", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.upsertLesson(lessonRow("l-old", "m1"));
    await store.setProgress("l-old", true, 70);

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
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

    const res = await syncCourses(store, session);
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 1 });
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
    expect(await store.getLesson("l-old")).toBeNull();
    // El progreso de la lección dada de baja se va con ella.
    expect(await store.getProgress("l-old")).toBeNull();
  });

  it("rellena por omisión el número de lección y el contenido que el remoto no trae", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        // Lección sin `lessonNumber` y sin `content`.
        json: async () => ({
          course: {
            modules: [
              { id: "m1", title: "M1", order: 0, lessons: [{ id: "l1", title: "L1", order: 0 }] },
            ],
          },
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryCourseStore();
    const res = await syncCourses(store, session);
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 1 });
    const lesson = await store.getLesson("l1");
    expect(lesson?.lessonNumber).toBeNull();
    expect(JSON.parse(String(lesson?.content))).toEqual({
      version: 2,
      blocks: [],
    });
  });

  it("un detalle remoto sin módulos deja el curso publicado sin módulos", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        // Payload incompleto: `course` sin la lista de módulos.
        json: async () => ({ course: {} }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = new MemoryCourseStore();
    const res = await syncCourses(store, session);
    expect(res).toEqual({ courses: 1, modules: 0, lessons: 0 });
    expect(await store.getCourse("c1")).not.toBeNull();
    expect(await store.listModuleIds("c1")).toEqual([]);
  });

  it("un curso duplicado en la lista remota no duplica filas locales", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/courses")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courses: [
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
              { id: "c1", title: "C1", description: null, status: "PUBLISHED", coverImage: null },
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
    const res = await syncCourses(store, session);
    // El store deduplica por id (upsert): una sola fila por curso.
    expect(await store.listCourseIds()).toEqual(["c1"]);
    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
    // El store deduplica por id (upsert): una sola fila por curso, y los
    // contadores reflejan los únicos.
    expect(res).toEqual({ courses: 1, modules: 1, lessons: 1 });
  });
});

/**
 * `flushCourseProgress` drena el outbox de progreso de cursos: marca cada
 * entrada como sincronizada SOLO ante respuesta `ok` del servidor.
 */
describe("flushCourseProgress", () => {
  function wordStore() {
    return new MemoryWordStore();
  }

  it("sin sesión no envía nada y deja el outbox pendiente", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const store = wordStore();
    await store.addOutbox("course_progress", "course_progress.set", JSON.stringify({ lessonId: "l1" }));

    await flushCourseProgress(new MemoryCourseStore(), store, null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.pendingOutbox()).length).toBe(1);
  });

  it("ignora las entradas que no son de progreso de cursos", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const store = wordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));

    await flushCourseProgress(new MemoryCourseStore(), store, session);

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.pendingOutbox()).length).toBe(1);
  });

  it("marca la entrada como sincronizada cuando el servidor responde ok", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const store = wordStore();
    await store.addOutbox(
      "course_progress",
      "course_progress.set",
      JSON.stringify({ lessonId: "l1", completed: true })
    );

    await flushCourseProgress(new MemoryCourseStore(), store, session);

    expect((await store.pendingOutbox()).length).toBe(0);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toContain("/api/progress");
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(String(call[1].body))).toEqual({
      lessonId: "l1",
      completed: true,
    });
  });

  it("deja la entrada pendiente cuando el servidor responde con error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) } as unknown as Response))
    );
    const store = wordStore();
    await store.addOutbox("course_progress", "course_progress.set", JSON.stringify({ lessonId: "l1" }));

    await flushCourseProgress(new MemoryCourseStore(), store, session);

    expect((await store.pendingOutbox()).length).toBe(1);
  });

  it("deja la entrada pendiente cuando el payload es inválido", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    const store = wordStore();
    await store.addOutbox("course_progress", "course_progress.set", "{no-es-json");

    await flushCourseProgress(new MemoryCourseStore(), store, session);

    // Ni se envía ni se marca: el payload roto se reintenta en el próximo drenado.
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.pendingOutbox()).length).toBe(1);
  });

  it("deja la entrada pendiente cuando la red falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const store = wordStore();
    await store.addOutbox("course_progress", "course_progress.set", JSON.stringify({ lessonId: "l1" }));

    await flushCourseProgress(new MemoryCourseStore(), store, session);

    expect((await store.pendingOutbox()).length).toBe(1);
  });
});
