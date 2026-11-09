import { describe, it, expect } from "vitest";
import type { SQLiteDatabase } from "expo-sqlite";
import { SQLiteCourseStore } from "./course-store";

/**
 * Caracterización de `SQLiteCourseStore` contra un stub de `SQLiteDatabase`
 * (sin SQLite real): fija el contrato normativo B2 — `BEGIN IMMEDIATE`
 * (nunca DEFERRED), `COMMIT`/`ROLLBACK` ordenados y borrado explícito de
 * `course_progress` antes que la fila de lección/módulo/curso.
 */

class FakeDb {
  readonly statements: string[] = [];
  modules: Array<{ id: string }> = [];
  lessons: Array<{ id: string }> = [];
  failOn: ((sql: string) => boolean) | null = null;

  asDb(): SQLiteDatabase {
    return this as unknown as SQLiteDatabase;
  }

  async execAsync(sql: string): Promise<void> {
    this.statements.push(sql);
    if (this.failOn?.(sql)) throw new Error(`fake fail: ${sql}`);
  }

  async runAsync(sql: string): Promise<unknown> {
    this.statements.push(sql);
    if (this.failOn?.(sql)) throw new Error(`fake fail: ${sql}`);
    return { lastInsertRowId: 0, changes: 1 };
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    this.statements.push(sql);
    if (sql.includes("FROM modules")) return this.modules as unknown as T[];
    if (sql.includes("FROM lessons")) return this.lessons as unknown as T[];
    return [];
  }

  async getFirstAsync(): Promise<null> {
    return null;
  }
}

describe("SQLiteCourseStore.runInTransaction (stub)", () => {
  it("usa BEGIN IMMEDIATE … COMMIT y retorna el resultado", async () => {
    const fake = new FakeDb();
    const store = new SQLiteCourseStore(fake.asDb());
    const result = await store.runInTransaction(async () => "ok");
    expect(result).toBe("ok");
    expect(fake.statements).toEqual(["BEGIN IMMEDIATE", "COMMIT"]);
  });

  it("ante fallo hace ROLLBACK y relanza la excepción original", async () => {
    const fake = new FakeDb();
    const store = new SQLiteCourseStore(fake.asDb());
    const boom = new Error("inject");
    await expect(
      store.runInTransaction(async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(fake.statements).toEqual(["BEGIN IMMEDIATE", "ROLLBACK"]);
  });

  it("removeCourse borra progreso explícito bottom-up dentro de la tx", async () => {
    const fake = new FakeDb();
    fake.modules = [{ id: "m1" }];
    fake.lessons = [{ id: "l1" }];
    const store = new SQLiteCourseStore(fake.asDb());
    await store.removeCourse("c1");
    const progressIdx = fake.statements.findIndex((s) =>
      s.startsWith("DELETE FROM course_progress")
    );
    const lessonIdx = fake.statements.findIndex((s) =>
      s.startsWith("DELETE FROM lessons")
    );
    const moduleIdx = fake.statements.findIndex((s) =>
      s.startsWith("DELETE FROM modules")
    );
    const courseIdx = fake.statements.findIndex((s) =>
      s.startsWith("DELETE FROM courses")
    );
    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(lessonIdx).toBeGreaterThanOrEqual(0);
    expect(moduleIdx).toBeGreaterThanOrEqual(0);
    expect(courseIdx).toBeGreaterThanOrEqual(0);
    // course_progress huérfano se borra antes que su lección, y el curso al final.
    expect(progressIdx).toBeLessThan(lessonIdx);
    expect(lessonIdx).toBeLessThan(moduleIdx);
    expect(moduleIdx).toBeLessThan(courseIdx);
  });
});
