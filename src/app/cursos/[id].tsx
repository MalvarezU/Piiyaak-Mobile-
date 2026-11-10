import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme, fonts, spacing, radiusScale } from "../../theme";
import type { CourseRow, ModuleRow } from "../../db/course-types";
import { Screen, ThemedText, Card } from "../../components/ui";
import { CourseCelebration } from "../../components/course-celebration";
import { CheckCircle2, Lock, ChevronRight } from "lucide-react-native";

export default function CursoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { courseStore } = useDb();
  const router = useRouter();
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!courseStore || !id) return;
      const cs = courseStore;
      if (!alive) return;
      const c = await cs.getCourse(String(id));
      if (alive && c) setCourse(c);
      const mods = await cs.getModules(String(id));
      // load lessons for each module
      const modsWithLessons: ModuleRow[] = [];
      const pm: Record<string, boolean> = {};
      for (const m of mods) {
        const lessons = await cs.getLessons(m.id);
        for (const l of lessons) {
          const p = await cs.getProgress(l.id);
          if (p) pm[l.id] = p.completed;
        }
        modsWithLessons.push({ ...m, lessons });
      }
      if (alive) {
        setModules(modsWithLessons);
        setProgressMap(pm);
      }
    })();
    return () => { alive = false; };
  }, [courseStore, id]);

  // Refresh progress when returning from a lesson
  useFocusEffect(
    useCallback(() => {
      if (!courseStore) return;
      (async () => {
        const pm: Record<string, boolean> = {};
        for (const m of modules) {
          for (const l of m.lessons) {
            const p = await courseStore.getProgress(l.id);
            if (p) pm[l.id] = p.completed;
          }
        }
        setProgressMap(pm);
      })();
    }, [courseStore, modules])
  );

  if (!course) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ThemedText variant="body" style={styles.muted}>
            Cargando curso...
          </ThemedText>
        </View>
      </Screen>
    );
  }

  const total = modules.reduce((a, m) => a + m.lessons.length, 0);
  const done = Object.values(progressMap).filter(Boolean).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // Celebración: al menos una lección y todas completadas en el progreso local.
  const isComplete =
    total > 0 &&
    modules.every((m) => m.lessons.every((l) => progressMap[l.id] === true));
  const firstLessonId = modules[0]?.lessons[0]?.id ?? null;

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText variant="title" style={styles.title}>
            {course.title}
          </ThemedText>
          {course.description ? (
            <ThemedText variant="body" style={styles.desc}>
              {course.description}
            </ThemedText>
          ) : null}
        </View>

        {total > 0 ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <ThemedText variant="caption" style={styles.progressCaption}>
              {done} de {total} lecciones · {pct}%
            </ThemedText>
          </View>
        ) : null}

        {isComplete && courseStore ? (
          <CourseCelebration
            courseId={course.id}
            courseTitle={course.title}
            firstLessonId={firstLessonId}
            courseStore={courseStore}
          />
        ) : null}

        {modules.map((mod) => (
          <View key={mod.id} style={styles.module}>
            <ThemedText
              variant="heading"
              style={styles.moduleTitle}
            >
              {mod.title}
            </ThemedText>
            <View style={styles.lessonList}>
              {mod.lessons.map((lesson, idx) => {
                const doneLesson = progressMap[lesson.id];
                const prevDone =
                  idx === 0 ||
                  progressMap[mod.lessons[idx - 1]?.id ?? ""] === true;
                const locked =
                  course?.sequential && !prevDone && idx > 0;

                const icon = doneLesson ? (
                  <CheckCircle2 size={20} color={theme.success} />
                ) : locked ? (
                  <Lock size={20} color={theme.muted} />
                ) : (
                  <ChevronRight size={20} color={theme.primary} />
                );

                return (
                  <Card
                    key={lesson.id}
                    style={[styles.lesson, locked ? styles.lessonLocked : null]}
                    onPress={
                      locked
                        ? undefined
                        : () =>
                            router.push({
                              pathname: "/cursos/leccion/[id]",
                              params: { id: lesson.id },
                            })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={lesson.title}
                    accessibilityState={locked ? { disabled: true } : undefined}
                  >
                    <View style={styles.lessonRow}>
                      {icon}
                      <View style={styles.lessonText}>
                        {lesson.lessonNumber ? (
                          <ThemedText
                            variant="caption"
                            style={styles.lessonNumber}
                          >
                            {lesson.lessonNumber}
                          </ThemedText>
                        ) : null}
                        <ThemedText variant="body" style={styles.lessonTitle}>
                          {lesson.title}
                        </ThemedText>
                      </View>
                    </View>
                  </Card>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  muted: { color: theme.muted },
  header: { gap: spacing.xs },
  title: { color: theme.text },
  desc: { color: theme.muted },
  progressBlock: { gap: spacing.xs },
  progressTrack: {
    height: 6,
    borderRadius: radiusScale.full,
    backgroundColor: theme.successSoft,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.primary,
  },
  progressCaption: {
    color: theme.muted,
    fontVariant: ["tabular-nums"],
  },
  module: { gap: spacing.sm },
  moduleTitle: {
    color: theme.primary,
    fontFamily: fonts.sansSemibold,
  },
  lessonList: { gap: spacing.sm },
  lesson: {},
  lessonLocked: { opacity: 0.5 },
  lessonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  lessonText: { flex: 1, gap: spacing.xs },
  lessonNumber: { color: theme.muted },
  lessonTitle: { color: theme.text },
});