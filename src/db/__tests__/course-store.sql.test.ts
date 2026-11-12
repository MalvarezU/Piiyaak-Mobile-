import { describe, it, expect, afterEach } from "vitest";
import { openNodeSqlite, type NodeSqliteHandle } from "./node-sqlite-shim";
import { SQLiteCourseStore } from "../course-store";
import { SQLiteWordStore, SCHEMA } from "../sqlite-store";
import type { CourseRow, ModuleRow, LessonRow } from "../course-types";

/**
 * Fase 1 — `SQLiteCourseStore` contra SQLite real (no stubs).
 *
 * El test previo (`src/db/course-store.sqlite.test.ts`) caracterizaba
 * `runInTransaction` y `removeCourse` contra un doble de `SQLiteDatabase`:
 * solo se verificaba el *orden de las sentencias*, nunca que el SQL
 * funcionara. Esta suite corre el SQL exacto de producción contra
 * `node:sqlite` mediante el shim `node-sqlite-shim.ts`.
 *
 * Lo que el stub NO podía demostrar y acá sí:
 * - que el `ROLLBACK` deja la base realmente sin cambios,
 * - que las foreign keys se respetan de verdad,
 * - que las constraints `NOT NULL` / `UNIQUE` / `CHECK` existen,
 * - que el `PRAGMA foreign_keys = ON` de `open()` tiene efecto.
 */

function course(id: string, extra?: Partial<CourseRow>): CourseRow {
  return {
    id,
    title: `Curso ${id}`,
    description: null,
    status: "PUBLISHED",
    coverImage: null,
    sequential: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function moduleRow(id: string, courseId: string, extra?: Partial<ModuleRow>): ModuleRow {
  return {
    id,
    courseId,
    title: `Módulo ${id}`,
    order: 0,
    lessons: [],
    ...extra,
  };
}

function lessonRow(id: string, moduleId: string, extra?: Partial<LessonRow>): LessonRow {
  return {
    id,
    moduleId,
    title: `Lección ${id}`,
    order: 0,
    lessonNumber: null,
    content: JSON.stringify({ version: 2, blocks: [] }),
    ...extra,
  };
}

/**
 * Abre una base con el esquema completo (el de `SCHEMA`) y el store de
 * cursos ya inicializado. El esquema lo crea `SQLiteWordStore.open` en
 * producción (misma conexión, B2): aquí se replica ese orden exacto.
 */
async function openCourseStore(): Promise<{
  handle: NodeSqliteHandle;
  store: SQLiteCourseStore;
}> {
  const handle = openNodeSqlite();
  await SQLiteWordStore.open(handle.db);
  const store = await SQLiteCourseStore.open(handle.db);
  return { handle, store };
}

/** Siembra un curso con un módulo y una lección (árbol mínimo). */
async function seed(
  store: SQLiteCourseStore,
  courseId = "c1",
  moduleId = "m1",
  lessonId = "l1"
): Promise<void> {
  await store.upsertCourse(course(courseId));
  await store.upsertModule(moduleRow(moduleId, courseId));
  await store.upsertLesson(lessonRow(lessonId, moduleId));
}

describe("SQLiteCourseStore.open", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("habilita las foreign keys con el PRAGMA foreign_keys = ON", async () => {
    // La FK con ON DELETE CASCADE solo es efectiva con foreign_keys=ON.
    // `node:sqlite` la trae activa de fábrica, así que primero la apagamos
    // para que el `open()` del store sea lo que la reactive.
    handle = openNodeSqlite();
    await SQLiteWordStore.open(handle.db);
    await handle.db.execAsync("PRAGMA foreign_keys = OFF");

    await SQLiteCourseStore.open(handle.db);

    const pragma = await handle.db.getFirstAsync<{ foreign_keys: number }>(
      "PRAGMA foreign_keys"
    );
    expect(pragma?.foreign_keys).toBe(1);
  });

  it("rechaza un módulo cuyo curso no existe por la foreign key", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await expect(
      store.upsertModule(moduleRow("m1", "curso-inexistente"))
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rechaza una lección cuyo módulo no existe por la foreign key", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await expect(
      store.upsertLesson(lessonRow("l1", "modulo-inexistente"))
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("rechaza un curso sin título por la constraint NOT NULL", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await expect(
      store.upsertCourse(course("c1", { title: null as unknown as string }))
    ).rejects.toThrow(/NOT NULL constraint failed/i);
  });
});

describe("SQLiteCourseStore.upsertCourse", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("inserta un curso con todos sus campos", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(
      course("c1", {
        title: "Nasa Yuwe básico",
        description: "Primer curso",
        coverImage: "https://cdn.test/c1.png",
        sequential: false,
      })
    );

    const fila = await store.getCourse("c1");
    expect(fila).toMatchObject({
      id: "c1",
      title: "Nasa Yuwe básico",
      description: "Primer curso",
      coverImage: "https://cdn.test/c1.png",
      sequential: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("actualiza los campos del curso cuando el id ya existe", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1", { title: "Título viejo" }));
    await store.upsertCourse(course("c1", { title: "Título nuevo" }));

    expect((await store.getCourse("c1"))?.title).toBe("Título nuevo");
    expect(await store.listCourseIds()).toEqual(["c1"]);
  });

  it("normaliza el flag sequential a 0/1 en la base", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1", { sequential: false }));

    const fila = await h.db.getFirstAsync<{ sequential: number }>(
      "SELECT sequential FROM courses WHERE id = 'c1'"
    );
    expect(fila?.sequential).toBe(0);
  });
});

describe("SQLiteCourseStore.upsertModule", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("inserta un módulo con su curso y su orden", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertModule(moduleRow("m1", "c1", { title: "Introducción", order: 2 }));

    const modulos = await store.getModules("c1");
    expect(modulos).toHaveLength(1);
    expect(modulos[0]).toMatchObject({ id: "m1", courseId: "c1", title: "Introducción", order: 2 });
  });

  it("actualiza el título y el orden cuando el id ya existe", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertModule(moduleRow("m1", "c1", { title: "Viejo", order: 1 }));
    await store.upsertModule(moduleRow("m1", "c1", { title: "Nuevo", order: 5 }));

    const modulos = await store.getModules("c1");
    expect(modulos).toHaveLength(1);
    expect(modulos[0]).toMatchObject({ title: "Nuevo", order: 5 });
  });

  it("no reasigna el courseId cuando el módulo ya existe", async () => {
    // FALLO DE PRODUCCIÓN (src/db/course-store.ts:57-58) — ver informe bug #2.
    // El `ON CONFLICT(id) DO UPDATE SET` actualiza `title` y `"order"` pero no
    // `courseId`. `MemoryCourseStore.upsertModule` sí reasigna el objeto
    // completo, así que las dos implementaciones de `CourseStore` divergen.
    // Consecuencia en `syncCourses`: un módulo movido de curso en el backend
    // conserva el courseId viejo, la reconciliación lo da por local y lo
    // borra (con sus lecciones y el progreso del usuario).
    // Marcado con `it.fails`: cuando se corrija `course-store.ts`, este test
    // pasará a fallar y avisará de que hay que quitar el marcador.
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertCourse(course("c2"));
    await store.upsertModule(moduleRow("m1", "c1"));
    await store.upsertModule(moduleRow("m1", "c2"));

    const fila = await h.db.getFirstAsync<{ courseId: string }>(
      "SELECT courseId FROM modules WHERE id = 'm1'"
    );
    expect(fila?.courseId).toBe("c2");
  });
});

describe("SQLiteCourseStore.upsertLesson", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("inserta una lección con su módulo y su contenido JSON", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);

    const lecciones = await store.getLessons("m1");
    expect(lecciones).toHaveLength(1);
    expect(lecciones[0]).toMatchObject({
      id: "l1",
      moduleId: "m1",
      title: "Lección l1",
      order: 0,
      lessonNumber: null,
      content: JSON.stringify({ version: 2, blocks: [] }),
    });
  });

  it("actualiza el contenido cuando el id ya existe", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.upsertLesson(
      lessonRow("l1", "m1", { title: "Reescrita", content: '{"version":2,"blocks":[]}' })
    );

    const leccion = await store.getLesson("l1");
    expect(leccion?.title).toBe("Reescrita");
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
  });

  it("no reasigna el moduleId cuando la lección ya existe", async () => {
    // FALLO DE PRODUCCIÓN (src/db/course-store.ts:65-66) — ver informe bug #2.
    // El `ON CONFLICT(id) DO UPDATE SET` no incluye `moduleId`, a diferencia de
    // `MemoryCourseStore.upsertLesson` que reemplaza la fila entera.
    // Marcado con `it.fails`: cuando se corrija `course-store.ts`, este test
    // pasará a fallar y avisará de que hay que quitar el marcador.
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertModule(moduleRow("m1", "c1"));
    await store.upsertModule(moduleRow("m2", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.upsertLesson(lessonRow("l1", "m2"));

    const fila = await h.db.getFirstAsync<{ moduleId: string }>(
      "SELECT moduleId FROM lessons WHERE id = 'l1'"
    );
    expect(fila?.moduleId).toBe("m2");
  });
});

describe("SQLiteCourseStore — lecturas", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("getCourses devuelve solo los cursos PUBLISHED ordenados por título", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1", { title: "Zeta" }));
    await store.upsertCourse(course("c2", { title: "Alfa" }));
    await store.upsertCourse(course("c3", { title: "Oculto", status: "DRAFT" }));

    const cursos = await store.getCourses();
    expect(cursos.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("getCourses devuelve progressPct null cuando el curso no tiene lecciones", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));

    expect((await store.getCourses())[0]?.progressPct).toBeNull();
  });

  it("getCourses calcula el porcentaje de avance sobre las lecciones completadas", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertModule(moduleRow("m1", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1"));
    await store.upsertLesson(lessonRow("l2", "m1"));
    await store.setProgress("l1", true, 100);

    expect((await store.getCourses())[0]?.progressPct).toBe(50);
  });

  it("getCourse devuelve null cuando el curso no existe", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    expect(await store.getCourse("no-existe")).toBeNull();
  });

  it("getModules filtra por curso y ordena por order", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertCourse(course("c2"));
    await store.upsertModule(moduleRow("m1", "c1", { order: 2 }));
    await store.upsertModule(moduleRow("m2", "c1", { order: 1 }));
    await store.upsertModule(moduleRow("m3", "c2", { order: 1 }));

    expect((await store.getModules("c1")).map((m) => m.id)).toEqual(["m2", "m1"]);
    expect((await store.getModules("c2")).map((m) => m.id)).toEqual(["m3"]);
  });

  it("getLessons filtra por módulo y ordena por order", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertModule(moduleRow("m1", "c1"));
    await store.upsertModule(moduleRow("m2", "c1"));
    await store.upsertLesson(lessonRow("l1", "m1", { order: 2 }));
    await store.upsertLesson(lessonRow("l2", "m1", { order: 1 }));
    await store.upsertLesson(lessonRow("l3", "m2", { order: 1 }));

    expect((await store.getLessons("m1")).map((l) => l.id)).toEqual(["l2", "l1"]);
  });

  it("getLesson devuelve null cuando la lección no existe", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    expect(await store.getLesson("no-existe")).toBeNull();
  });

  it("listCourseIds devuelve los ids de todos los cursos locales", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertCourse(course("c2", { status: "DRAFT" }));

    expect((await store.listCourseIds()).sort()).toEqual(["c1", "c2"]);
  });

  it("listModuleIds devuelve los ids de los módulos del curso", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await store.upsertCourse(course("c2"));
    await store.upsertModule(moduleRow("m1", "c1"));
    await store.upsertModule(moduleRow("m2", "c2"));

    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listModuleIds("c2")).toEqual(["m2"]);
  });

  it("listLessonIds devuelve los ids de las lecciones del módulo", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);

    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
  });
});

describe("SQLiteCourseStore — progreso", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("setProgress registra la lección completada con su score", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", true, 100);

    const progreso = await store.getProgress("l1");
    expect(progreso).toMatchObject({ lessonId: "l1", completed: true, score: 100 });
    expect(progreso?.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("setProgress con completed false deja completedAt en null", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", false);

    const progreso = await store.getProgress("l1");
    expect(progreso?.completed).toBe(false);
    expect(progreso?.completedAt).toBeNull();
  });

  it("setProgress actualiza el progreso existente de la misma lección", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", true, 100);
    await store.setProgress("l1", false);

    expect((await store.getAllProgress()).length).toBe(1);
    expect((await store.getProgress("l1"))?.completed).toBe(false);
  });

  it("getProgress devuelve null cuando la lección no tiene progreso", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);

    expect(await store.getProgress("l1")).toBeNull();
  });

  it("getAllProgress devuelve el progreso de todas las lecciones", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.upsertLesson(lessonRow("l2", "m1"));
    await store.setProgress("l1", true, 100);
    await store.setProgress("l2", true, 90);

    const progreso = await store.getAllProgress();
    expect(progreso.map((p) => p.lessonId).sort()).toEqual(["l1", "l2"]);
    expect(progreso.every((p) => p.completed === true)).toBe(true);
  });
});

describe("SQLiteCourseStore.runInTransaction", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("confirma los cambios y retorna el valor del callback", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    const resultado = await store.runInTransaction(async () => {
      await store.upsertCourse(course("c1"));
      return "ok";
    });

    expect(resultado).toBe("ok");
    expect(await store.getCourse("c1")).not.toBeNull();
  });

  it("deja la base SIN cambios cuando el callback falla", async () => {
    // Esto es lo que el stub no podía probar: `runInTransaction` solo
    // verificaba que se emitiera "ROLLBACK", no que la base quedara limpia.
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    const boom = new Error("fallo inyectado");

    await expect(
      store.runInTransaction(async () => {
        await store.upsertCourse(course("c2"));
        await store.upsertModule(moduleRow("m2", "c2"));
        await store.upsertLesson(lessonRow("l2", "m2"));
        throw boom;
      })
    ).rejects.toBe(boom);

    // La base conserva el estado previo, sin rastros de la transacción.
    expect(await store.getCourse("c2")).toBeNull();
    expect(await store.listCourseIds()).toEqual(["c1"]);
    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
    const filas = await h.db.getAllAsync<{ id: string }>(
      "SELECT id FROM courses"
    );
    expect(filas.map((f) => f.id)).toEqual(["c1"]);
  });

  it("descarta también las escrituras de progreso hechas dentro de la transacción fallida", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);

    await expect(
      store.runInTransaction(async () => {
        await store.setProgress("l1", true, 100);
        throw new Error("fallo inyectado");
      })
    ).rejects.toThrow(/fallo inyectado/);

    expect(await store.getProgress("l1")).toBeNull();
  });

  it("relanza la excepción original sin taparla con el error del ROLLBACK", async () => {
    // El ROLLBACK es best-effort: si la transacción ya no está activa, su
    // error se traga y manda la excepción original.
    const { handle: h, store } = await openCourseStore();
    handle = h;

    const boom = new Error("boom original");

    await expect(
      store.runInTransaction(async () => {
        await h.db.execAsync("ROLLBACK");
        throw boom;
      })
    ).rejects.toBe(boom);
  });
});

describe("SQLiteCourseStore — borrados", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("removeCourse borra el curso, sus módulos, sus lecciones y el progreso", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", true, 100);

    await store.removeCourse("c1");

    expect(await store.getCourse("c1")).toBeNull();
    expect(await store.listModuleIds("c1")).toEqual([]);
    expect(await store.listLessonIds("m1")).toEqual([]);
    expect(await store.getProgress("l1")).toBeNull();
  });

  it("removeModule borra el módulo, sus lecciones y su progreso", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", true, 100);

    await store.removeModule("m1");

    expect(await store.getLesson("l1")).toBeNull();
    expect(await store.getProgress("l1")).toBeNull();
    expect(await store.getCourse("c1")).not.toBeNull();
  });

  it("removeLesson borra la lección y su progreso", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);
    await store.setProgress("l1", true, 100);

    await store.removeLesson("l1");

    expect(await store.getLesson("l1")).toBeNull();
    expect(await store.getProgress("l1")).toBeNull();
  });

  it("clearCourses vacía cursos, módulos y lecciones", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await seed(store);

    await store.clearCourses();

    expect(await store.listCourseIds()).toEqual([]);
    const modulos = await h.db.getAllAsync<{ id: string }>(
      "SELECT id FROM modules"
    );
    const lecciones = await h.db.getAllAsync<{ id: string }>(
      "SELECT id FROM lessons"
    );
    expect(modulos).toEqual([]);
    expect(lecciones).toEqual([]);
  });
});

describe("SQLiteCourseStore — el schema como contrato", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("declara la FK de modules hacia courses en el schema", () => {
    expect(SCHEMA).toContain(
      "FOREIGN KEY (courseId) REFERENCES courses(id) ON DELETE CASCADE"
    );
    expect(SCHEMA).toContain(
      "FOREIGN KEY (moduleId) REFERENCES modules(id) ON DELETE CASCADE"
    );
  });

  it("rechaza un curso duplicado por la primary key", async () => {
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.upsertCourse(course("c1"));
    await expect(
      h.db.runAsync(
        "INSERT INTO courses (id, title, updatedAt) VALUES (?, ?, ?)",
        ["c1", "Otro", "2026-01-01"]
      )
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("course_progress no tiene foreign key: admite progreso de una lección borrada", async () => {
    // Documenta el diseño (B2 §1.2): el progreso huérfano se limpia por
    // barrido explícito en `syncCourses`, no por constraint.
    const { handle: h, store } = await openCourseStore();
    handle = h;

    await store.setProgress("leccion-fantasma", true, 50);

    expect((await store.getAllProgress()).map((p) => p.lessonId)).toEqual([
      "leccion-fantasma",
    ]);
  });
});
