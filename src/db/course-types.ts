export interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  coverImage: string | null;
  sequential: boolean;
  updatedAt: string;
  modules?: ModuleRow[];
  progressPct?: number | null;
}

export interface ModuleRow {
  id: string;
  courseId: string;
  title: string;
  order: number;
  lessons: LessonRow[];
}

export interface LessonRow {
  id: string;
  moduleId: string;
  title: string;
  order: number;
  lessonNumber: string | null;
  content: string; // JSON string of LessonContent
}

export interface CourseProgressRow {
  lessonId: string;
  completed: boolean;
  score: number | null;
  lastVisitedAt: string;
  completedAt: string | null;
}