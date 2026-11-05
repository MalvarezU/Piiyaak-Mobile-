import { apiFetch, type SessionState } from "../api";
import type { CourseStore } from "./course-store";
import type { CourseRow, ModuleRow, LessonRow } from "./course-types";

export interface CourseSyncResult {
  courses: number;
  modules: number;
  lessons: number;
}

export async function syncCourses(
  store: CourseStore,
  session: SessionState | null
): Promise<CourseSyncResult> {
  const res = await apiFetch("/api/courses", {}, session);
  if (!res.ok) throw new Error(`courses ${res.status}`);
  const body = (await res.json()) as { courses: Array<{ id: string; title: string; description: string | null; status: string; coverImage: string | null; modules: number; lessons: number; progressPct: number | null }> };

  await store.clearCourses();
  let modCount = 0;
  let lesCount = 0;

  for (const c of body.courses) {
    await store.upsertCourse({
      id: c.id,
      title: c.title,
      description: c.description,
      status: c.status,
      coverImage: c.coverImage,
      sequential: true,
      updatedAt: new Date().toISOString(),
    });

    // Fetch full course tree
    const detailRes = await apiFetch(`/api/courses/${c.id}`, {}, session);
    if (!detailRes.ok) continue;
    const detail = (await detailRes.json()) as { course: { modules: Array<{ id: string; title: string; order: number; lessons: Array<{ id: string; title: string; order: number; lessonNumber: number | null; content: unknown }> }> } };
    const course = detail.course;

    for (const m of course.modules) {
      await store.upsertModule({
        id: m.id,
        courseId: c.id,
        title: m.title,
        order: m.order,
        lessons: [],
      });
      modCount++;

      for (const l of m.lessons) {
        await store.upsertLesson({
          id: l.id,
          moduleId: m.id,
          title: l.title,
          order: l.order,
          lessonNumber: l.lessonNumber != null ? String(l.lessonNumber) : null,
          content: JSON.stringify(l.content ?? { version: 2, blocks: [] }),
        });
        lesCount++;
      }
    }
  }

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