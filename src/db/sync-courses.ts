import { apiFetch, type SessionState } from "../api";
import type { CourseStore } from "./course-store";
import type { CourseRow, ModuleRow, LessonRow } from "./course-types";

export interface CourseSyncResult {
  courses: number;
  modules: number;
  lessons: number;
}

interface RemoteCourseSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  coverImage: string | null;
}

interface RemoteDetail {
  course: {
    modules: Array<{
      id: string;
      title: string;
      order: number;
      lessons: Array<{
        id: string;
        title: string;
        order: number;
        lessonNumber: number | null;
        content: unknown;
      }>;
    }>;
  };
}

/**
 * Sincronización atómica de cursos (B2, opción U: upsert en transacción).
 *
 * Fases:
 * 1. Descarga completa a memoria (lista + detalle por curso). Cualquier
 *    fallo de red aquí propaga ANTES de tocar el store: el contenido previo
 *    queda intacto y no se escribe versión ni cursor.
 * 2. Una sola `runInTransaction`: upserts del árbol curso→módulo→lección,
 *    reconciliación de bajas (ids locales ausentes en remoto, incluido
 *    `course_progress` huérfano) y barrido de progreso sin lección.
 *
 * Prohibida la secuencia destructiva previa a la descarga (B2).
 * omite el encabezado de autenticación (lectura pública, CA3).
 */
export async function syncCourses(
  store: CourseStore,
  session: SessionState | null
): Promise<CourseSyncResult> {
  const res = await apiFetch("/api/courses", {}, session);
  if (!res.ok) throw new Error(`courses ${res.status}`);
  const body = (await res.json()) as { courses: RemoteCourseSummary[] };

  // Fase 1: descarga a memoria, sin tocar el store.
  const trees = new Map<string, RemoteDetail["course"]["modules"]>();
  for (const c of body.courses) {
    const detailRes = await apiFetch(`/api/courses/${c.id}`, {}, session);
    if (!detailRes.ok) throw new Error(`course ${c.id} ${detailRes.status}`);
    const detail = (await detailRes.json()) as RemoteDetail;
    trees.set(c.id, detail.course.modules);
  }

  // Fase 2: aplicación atómica.
  let modCount = 0;
  let lesCount = 0;
  await store.runInTransaction(async () => {
    const remoteCourseIds = new Set(body.courses.map((c) => c.id));
    const remoteModuleIds = new Map<string, Set<string>>();
    const remoteLessonIds = new Map<string, Set<string>>();
    const allRemoteLessonIds = new Set<string>();

    for (const c of body.courses) {
      const courseRow: CourseRow = {
        id: c.id,
        title: c.title,
        description: c.description,
        status: c.status,
        coverImage: c.coverImage,
        sequential: true,
        updatedAt: new Date().toISOString(),
      };
      await store.upsertCourse(courseRow);
      const moduleIds = new Set<string>();
      for (const m of trees.get(c.id) ?? []) {
        const moduleRow: ModuleRow = {
          id: m.id,
          courseId: c.id,
          title: m.title,
          order: m.order,
          lessons: [],
        };
        await store.upsertModule(moduleRow);
        moduleIds.add(m.id);
        modCount++;
        const lessonIds = new Set<string>();
        for (const l of m.lessons) {
          const lessonRow: LessonRow = {
            id: l.id,
            moduleId: m.id,
            title: l.title,
            order: l.order,
            lessonNumber: l.lessonNumber != null ? String(l.lessonNumber) : null,
            content: JSON.stringify(l.content ?? { version: 2, blocks: [] }),
          };
          await store.upsertLesson(lessonRow);
          lessonIds.add(l.id);
          allRemoteLessonIds.add(l.id);
          lesCount++;
        }
        remoteLessonIds.set(m.id, lessonIds);
      }
      remoteModuleIds.set(c.id, moduleIds);
    }

    // Reconciliación de bajas dentro de la misma tx (nunca antes).
    for (const localId of await store.listCourseIds()) {
      if (!remoteCourseIds.has(localId)) {
        await store.removeCourse(localId);
      }
    }
    for (const courseId of remoteCourseIds) {
      const remote = remoteModuleIds.get(courseId) ?? new Set();
      for (const localId of await store.listModuleIds(courseId)) {
        if (!remote.has(localId)) {
          await store.removeModule(localId);
        }
      }
    }
    for (const courseId of remoteCourseIds) {
      for (const moduleId of remoteModuleIds.get(courseId) ?? []) {
        const remote = remoteLessonIds.get(moduleId) ?? new Set();
        for (const localId of await store.listLessonIds(moduleId)) {
          if (!remote.has(localId)) {
            await store.removeLesson(localId);
          }
        }
      }
    }
    // Barrido de progreso huérfano: lecciones sin contenido vigente
    // (bajas de versiones previas o progreso de lecciones inexistentes).
    for (const p of await store.getAllProgress()) {
      if (!allRemoteLessonIds.has(p.lessonId)) {
        await store.removeLesson(p.lessonId);
      }
    }
  });

  return { courses: body.courses.length, modules: modCount, lessons: lesCount };
}

/** Drena el outbox de progreso de cursos al servidor. */
export async function flushCourseProgress(
  store: CourseStore,
  wordStore: { pendingOutbox: () => Promise<Array<{ id: number; entity: string; op: string; payload: string }>>; markOutboxSynced: (id: number) => Promise<void> },
  session: SessionState | null
): Promise<void> {
  if (!session) return;
  const pending = await wordStore.pendingOutbox();
  for (const row of pending) {
    if (row.entity !== "course_progress") continue;
    try {
      const payload = JSON.parse(row.payload);
      const res = await apiFetch("/api/progress", { method: "POST", body: JSON.stringify(payload) }, session);
      if (res.ok) await wordStore.markOutboxSynced(row.id);
    } catch {
      // leave pending
    }
  }
}
