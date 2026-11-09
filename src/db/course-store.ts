import type { SQLiteDatabase } from "expo-sqlite";
import type { CourseRow, ModuleRow, LessonRow, CourseProgressRow } from "./course-types";

export interface CourseStore {
  upsertCourse(course: CourseRow): Promise<void>;
  upsertModule(mod: ModuleRow): Promise<void>;
  upsertLesson(lesson: LessonRow): Promise<void>;
  removeCourse(id: string): Promise<void>;
  removeModule(id: string): Promise<void>;
  removeLesson(id: string): Promise<void>;
  listCourseIds(): Promise<string[]>;
  listModuleIds(courseId: string): Promise<string[]>;
  listLessonIds(moduleId: string): Promise<string[]>;
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
  getCourses(): Promise<CourseRow[]>;
  getCourse(id: string): Promise<CourseRow | null>;
  getModules(courseId: string): Promise<ModuleRow[]>;
  getLessons(moduleId: string): Promise<LessonRow[]>;
  getLesson(id: string): Promise<LessonRow | null>;
  setProgress(lessonId: string, completed: boolean, score?: number | null): Promise<void>;
  getProgress(lessonId: string): Promise<CourseProgressRow | null>;
  getAllProgress(): Promise<CourseProgressRow[]>;
  clearCourses(): Promise<void>;
}

export class SQLiteCourseStore implements CourseStore {
  constructor(private db: SQLiteDatabase) {}

  static async open(db: SQLiteDatabase): Promise<SQLiteCourseStore> {
    // Las FK con ON DELETE CASCADE solo son efectivas con foreign_keys=ON
    // (SQLite lo trae OFF por defecto). Se habilita por conexión; como B2
    // unifica a una sola conexión, basta con fijarlo aquí. Los borrados de
    // remove* son explícitos bottom-up de todos modos (course_progress no
    // tiene CASCADE), así que el PRAGMA es defensa en profundidad.
    await db.execAsync("PRAGMA foreign_keys = ON");
    return new SQLiteCourseStore(db);
  }

  async upsertCourse(course: CourseRow): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO courses (id, title, description, status, coverImage, sequential, updatedAt)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, description=excluded.description,
         status=excluded.status, coverImage=excluded.coverImage,
         sequential=excluded.sequential, updatedAt=excluded.updatedAt`,
      [course.id, course.title, course.description, course.status, course.coverImage, course.sequential ? 1 : 0, course.updatedAt]
    );
  }

  async upsertModule(mod: ModuleRow): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO modules (id, courseId, title, "order") VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, "order"=excluded."order"`,
      [mod.id, mod.courseId, mod.title, mod.order]
    );
  }

  async upsertLesson(lesson: LessonRow): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO lessons (id, moduleId, title, "order", lessonNumber, content) VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, "order"=excluded."order", lessonNumber=excluded.lessonNumber, content=excluded.content`,
      [lesson.id, lesson.moduleId, lesson.title, lesson.order, lesson.lessonNumber, lesson.content]
    );
  }

  async getCourses(): Promise<CourseRow[]> {
    const rows = await this.db.getAllAsync<any>("SELECT * FROM courses WHERE status = 'PUBLISHED' ORDER BY title");
    const result: CourseRow[] = [];
    for (const r of rows) {
      const mods = await this.db.getAllAsync<any>('SELECT id FROM modules WHERE courseId = ?', [r.id]);
      const lessonIds = [];
      for (const m of mods) {
        const ls = await this.db.getAllAsync<any>('SELECT id FROM lessons WHERE moduleId = ?', [m.id]);
        for (const l of ls) lessonIds.push(l.id);
      }
      let done = 0;
      if (lessonIds.length > 0) {
        const placeholders = lessonIds.map(() => "?").join(",");
        const prog = await this.db.getAllAsync<any>(`SELECT completed FROM course_progress WHERE lessonId IN (${placeholders})`, lessonIds);
        done = prog.filter((p: any) => p.completed).length;
      }
      const pct = lessonIds.length > 0 ? Math.round((done / lessonIds.length) * 100) : null;
      result.push({ ...r, sequential: !!r.sequential, modules: [], progressPct: pct });
    }
    return result;
  }

  async getCourse(id: string): Promise<CourseRow | null> {
    const row = await this.db.getFirstAsync<any>("SELECT * FROM courses WHERE id = ?", [id]);
    if (!row) return null;
    return { ...row, sequential: !!row.sequential };
  }

  async getModules(courseId: string): Promise<ModuleRow[]> {
    const rows = await this.db.getAllAsync<any>('SELECT * FROM modules WHERE courseId = ? ORDER BY "order"', [courseId]);
    return rows.map((r) => ({ ...r, lessons: [] }));
  }

  async getLessons(moduleId: string): Promise<LessonRow[]> {
    const rows = await this.db.getAllAsync<any>('SELECT * FROM lessons WHERE moduleId = ? ORDER BY "order"', [moduleId]);
    return rows.map((r) => ({ ...r, order: r.order ?? 0, lessonNumber: r.lessonNumber ?? null, content: r.content ?? "{}" }));
  }

  async getLesson(id: string): Promise<LessonRow | null> {
    const row = await this.db.getFirstAsync<any>("SELECT * FROM lessons WHERE id = ?", [id]);
    if (!row) return null;
    return { ...row, order: row.order ?? 0, lessonNumber: row.lessonNumber ?? null, content: row.content ?? "{}" };
  }

  async setProgress(lessonId: string, completed: boolean, score?: number | null): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runAsync(
      `INSERT INTO course_progress (lessonId, completed, score, lastVisitedAt, completedAt) VALUES (?,?,?,?,?)
       ON CONFLICT(lessonId) DO UPDATE SET completed=excluded.completed, score=excluded.score, lastVisitedAt=excluded.lastVisitedAt, completedAt=excluded.completedAt`,
      [lessonId, completed ? 1 : 0, score ?? null, now, completed ? now : null]
    );
  }

  async getProgress(lessonId: string): Promise<CourseProgressRow | null> {
    const row = await this.db.getFirstAsync<any>("SELECT * FROM course_progress WHERE lessonId = ?", [lessonId]);
    if (!row) return null;
    return { lessonId: row.lessonId, completed: !!row.completed, score: row.score, lastVisitedAt: row.lastVisitedAt, completedAt: row.completedAt };
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    // BEGIN IMMEDIATE: adquiere el lock de escritura al entrar (nunca DEFERRED,
    // que arriesga SQLITE_BUSY silencioso ante lecturas del hilo de UI).
    await this.db.execAsync("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      await this.db.execAsync("COMMIT");
      return result;
    } catch (err) {
      try {
        await this.db.execAsync("ROLLBACK");
      } catch {
        // ROLLBACK best-effort: la excepción original es la que se relanza.
      }
      throw err;
    }
  }

  async removeCourse(id: string): Promise<void> {
    // Borrado explícito bottom-up dentro de la tx del llamador: course_progress
    // no tiene ON DELETE CASCADE (las FK solo cubren modules/lessons).
    const mods = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM modules WHERE courseId = ?",
      [id]
    );
    for (const m of mods) {
      await this.removeModule(m.id);
    }
    await this.db.runAsync("DELETE FROM courses WHERE id = ?", [id]);
  }

  async removeModule(id: string): Promise<void> {
    const lessons = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM lessons WHERE moduleId = ?",
      [id]
    );
    for (const l of lessons) {
      await this.removeLesson(l.id);
    }
    await this.db.runAsync("DELETE FROM modules WHERE id = ?", [id]);
  }

  async removeLesson(id: string): Promise<void> {
    await this.db.runAsync("DELETE FROM course_progress WHERE lessonId = ?", [id]);
    await this.db.runAsync("DELETE FROM lessons WHERE id = ?", [id]);
  }

  async listCourseIds(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM courses"
    );
    return rows.map((r) => r.id);
  }

  async listModuleIds(courseId: string): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM modules WHERE courseId = ?",
      [courseId]
    );
    return rows.map((r) => r.id);
  }

  async listLessonIds(moduleId: string): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ id: string }>(
      "SELECT id FROM lessons WHERE moduleId = ?",
      [moduleId]
    );
    return rows.map((r) => r.id);
  }

  async getAllProgress(): Promise<CourseProgressRow[]> {
    const rows = await this.db.getAllAsync<any>("SELECT * FROM course_progress");
    return rows.map((r) => ({ lessonId: r.lessonId, completed: !!r.completed, score: r.score, lastVisitedAt: r.lastVisitedAt, completedAt: r.completedAt }));
  }

  async clearCourses(): Promise<void> {
    await this.db.runAsync("DELETE FROM lessons");
    await this.db.runAsync("DELETE FROM modules");
    await this.db.runAsync("DELETE FROM courses");
  }
}

// In-memory implementation for tests
export class MemoryCourseStore implements CourseStore {
  private courses = new Map<string, CourseRow>();
  private modules = new Map<string, ModuleRow>();
  private lessons = new Map<string, LessonRow>();
  private progress = new Map<string, CourseProgressRow>();

  async upsertCourse(course: CourseRow): Promise<void> { this.courses.set(course.id, { ...course, modules: [] }); }
  async upsertModule(mod: ModuleRow): Promise<void> { this.modules.set(mod.id, { ...mod, lessons: [] }); }
  async upsertLesson(lesson: LessonRow): Promise<void> { this.lessons.set(lesson.id, { ...lesson }); }
  async getCourses(): Promise<CourseRow[]> { return [...this.courses.values()].filter((c) => c.status === "PUBLISHED").map((c) => ({ ...c, modules: [] })); }
  async getCourse(id: string): Promise<CourseRow | null> { const c = this.courses.get(id); return c ? { ...c, modules: [] } : null; }
  async getModules(courseId: string): Promise<ModuleRow[]> { return [...this.modules.values()].filter((m) => m.courseId === courseId).map((m) => ({ ...m, lessons: [] })); }
  async getLessons(moduleId: string): Promise<LessonRow[]> { return [...this.lessons.values()].filter((l) => l.moduleId === moduleId); }
  async getLesson(id: string): Promise<LessonRow | null> { const l = this.lessons.get(id); return l ? { ...l } : null; }
  async setProgress(lessonId: string, completed: boolean, score?: number | null): Promise<void> {
    const now = new Date().toISOString();
    this.progress.set(lessonId, { lessonId, completed, score: score ?? null, lastVisitedAt: now, completedAt: completed ? now : null });
  }
  async getProgress(lessonId: string): Promise<CourseProgressRow | null> { return this.progress.get(lessonId) ?? null; }
  async getAllProgress(): Promise<CourseProgressRow[]> { return [...this.progress.values()]; }
  async clearCourses(): Promise<void> { this.courses.clear(); this.modules.clear(); this.lessons.clear(); }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    // Rollback por snapshot: copia de los mapas al entrar; ante excepción,
    // restaura y relanza la excepción original (semántica exigida §1.2).
    const snapshot = {
      courses: new Map(this.courses),
      modules: new Map(this.modules),
      lessons: new Map(this.lessons),
      progress: new Map(this.progress),
    };
    try {
      return await fn();
    } catch (err) {
      this.courses = snapshot.courses;
      this.modules = snapshot.modules;
      this.lessons = snapshot.lessons;
      this.progress = snapshot.progress;
      throw err;
    }
  }

  async removeCourse(id: string): Promise<void> {
    // Cascada en memoria (espeja SQLite + borrado explícito de progreso).
    for (const m of [...this.modules.values()]) {
      if (m.courseId === id) await this.removeModule(m.id);
    }
    this.courses.delete(id);
  }

  async removeModule(id: string): Promise<void> {
    for (const l of [...this.lessons.values()]) {
      if (l.moduleId === id) await this.removeLesson(l.id);
    }
    this.modules.delete(id);
  }

  async removeLesson(id: string): Promise<void> {
    this.progress.delete(id);
    this.lessons.delete(id);
  }

  async listCourseIds(): Promise<string[]> { return [...this.courses.keys()]; }
  async listModuleIds(courseId: string): Promise<string[]> {
    return [...this.modules.values()].filter((m) => m.courseId === courseId).map((m) => m.id);
  }
  async listLessonIds(moduleId: string): Promise<string[]> {
    return [...this.lessons.values()].filter((l) => l.moduleId === moduleId).map((l) => l.id);
  }
}