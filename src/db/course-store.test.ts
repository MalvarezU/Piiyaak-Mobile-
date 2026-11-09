import { describe, it, expect } from "vitest";
import { MemoryCourseStore } from "./course-store";

function course(id: string, title = `Course ${id}`) {
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

function mod(id: string, courseId: string) {
  return { id, courseId, title: `Mod ${id}`, order: 0, lessons: [] };
}

function lesson(id: string, moduleId: string) {
  return {
    id,
    moduleId,
    title: `Lesson ${id}`,
    order: 0,
    lessonNumber: null,
    content: JSON.stringify({ version: 2, blocks: [] }),
  };
}

async function seed(store: MemoryCourseStore) {
  await store.upsertCourse(course("c1"));
  await store.upsertModule(mod("m1", "c1"));
  await store.upsertLesson(lesson("l1", "m1"));
  await store.setProgress("l1", true, 100);
}

describe("MemoryCourseStore.runInTransaction", () => {
  it("revierte el snapshot ante fallo en upsert y relanza la excepción original", async () => {
    const store = new MemoryCourseStore();
    await seed(store);
    const before = {
      courses: await store.getCourses(),
      modules: await store.getModules("c1"),
      lessons: await store.getLessons("m1"),
      progress: await store.getAllProgress(),
    };

    const boom = new Error("inject: upsertLesson failed");
    await expect(
      store.runInTransaction(async () => {
        await store.upsertCourse(course("c2"));
        await store.upsertModule(mod("m2", "c2"));
        throw boom;
      })
    ).rejects.toBe(boom);

    expect(await store.getCourses()).toEqual(before.courses);
    expect(await store.getModules("c1")).toEqual(before.modules);
    expect(await store.getLessons("m1")).toEqual(before.lessons);
    expect(await store.getAllProgress()).toEqual(before.progress);
    expect(await store.getCourse("c2")).toBeNull();
  });

  it("confirma los cambios cuando la transacción completa sin error", async () => {
    const store = new MemoryCourseStore();
    await seed(store);
    await store.runInTransaction(async () => {
      await store.upsertCourse(course("c2"));
      await store.upsertModule(mod("m2", "c2"));
      await store.upsertLesson(lesson("l2", "m2"));
    });
    expect(await store.getCourse("c2")).not.toBeNull();
    expect(await store.getModules("c2")).toHaveLength(1);
    expect(await store.getLessons("m2")).toHaveLength(1);
    // Lo previo sigue intacto.
    expect(await store.getCourse("c1")).not.toBeNull();
  });

  it("removeCourse elimina en cascada módulos, lecciones y progreso asociado", async () => {
    const store = new MemoryCourseStore();
    await seed(store);
    await store.removeCourse("c1");
    expect(await store.getCourse("c1")).toBeNull();
    expect(await store.getModules("c1")).toEqual([]);
    expect(await store.getLessons("m1")).toEqual([]);
    expect(await store.getProgress("l1")).toBeNull();
  });

  it("list*Ids expone los ids locales por nivel", async () => {
    const store = new MemoryCourseStore();
    await seed(store);
    await store.upsertCourse(course("c2"));
    expect(await store.listCourseIds()).toEqual(
      expect.arrayContaining(["c1", "c2"])
    );
    expect(await store.listModuleIds("c1")).toEqual(["m1"]);
    expect(await store.listLessonIds("m1")).toEqual(["l1"]);
  });

  it("removeModule y removeLesson limpian progreso huérfano del nivel", async () => {
    const store = new MemoryCourseStore();
    await seed(store);
    await store.removeLesson("l1");
    expect(await store.getLesson("l1")).toBeNull();
    expect(await store.getProgress("l1")).toBeNull();
    await store.upsertModule(mod("m2", "c1"));
    await store.upsertLesson(lesson("l2", "m2"));
    await store.setProgress("l2", true, null);
    await store.removeModule("m2");
    expect(await store.getLessons("m2")).toEqual([]);
    expect(await store.getProgress("l2")).toBeNull();
  });
});
