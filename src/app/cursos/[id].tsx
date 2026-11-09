import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import type { CourseRow, ModuleRow, LessonRow } from "../../db/course-types";

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
    return <View style={styles.root}><Text style={styles.muted}>Cargando curso...</Text></View>;
  }

  return (
    <ScrollView style={styles.root}>
      <Text style={styles.title}>{course.title}</Text>
      {course.description ? <Text style={styles.desc}>{course.description}</Text> : null}
      {(() => {
        const total = modules.reduce((a, m) => a + m.lessons.length, 0);
        const done = Object.values(progressMap).filter(Boolean).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return total > 0 ? <Text style={styles.progress}>{done}/{total} lecciones completadas ({pct}%)</Text> : null;
      })()}
      {modules.map((mod) => (
        <View key={mod.id} style={styles.module}>
          <Text style={styles.moduleTitle}>{mod.title}</Text>
          {mod.lessons.map((lesson, idx) => {
            const done = progressMap[lesson.id];
            const prevDone = idx === 0 || progressMap[mod.lessons[idx - 1]?.id ?? ""] === true;
            const locked = course?.sequential && !prevDone && idx > 0;
            return (
              <TouchableOpacity
                key={lesson.id}
                style={[styles.lesson, locked ? styles.lessonLocked : null]}
                onPress={() => {
                  if (locked) return;
                  router.push({ pathname: "/cursos/leccion/[id]", params: { id: lesson.id } });
                }}
                disabled={locked}
              >
                <Text style={styles.lessonTitle}>
                  {done ? "✓ " : locked ? "🔒 " : ""}{lesson.lessonNumber ? `${lesson.lessonNumber} ` : ""}{lesson.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", color: theme.primary, marginBottom: 8 },
  desc: { fontSize: 15, color: theme.muted, marginBottom: 12, lineHeight: 22 },
  progress: { fontSize: 14, color: theme.primary, marginBottom: 12, fontWeight: "600" },
  module: { marginBottom: 16 },
  moduleTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8, color: theme.primary },
  lesson: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  lessonLocked: { opacity: 0.5 },
  lessonTitle: { fontSize: 16 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});