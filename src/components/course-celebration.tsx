/**
 * Celebración de curso completado (paridad web course-celebration.tsx).
 *
 * Se monta solo cuando el curso tiene al menos una lección y todas están
 * completadas (decisión de la pantalla de detalle, no de este componente).
 * No toca el progreso: solo lee el catálogo para sugerencias y navega.
 *
 * Las sugerencias replican selectCourseSuggestions de la web: otros cursos
 * publicados con contenido, excluyendo el actual, sin progreso primero,
 * máximo 3. En el store del app `progressPct` es null cuando el curso no
 * tiene lecciones (lo calcula getCourses), así que el filtro es numérico.
 */
import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Award } from "lucide-react-native";
import { theme, spacing } from "../theme";
import { Card, ThemedText, Button } from "./ui";
import type { CourseRow } from "../db/course-types";
import type { CourseStore } from "../db/course-store";

export interface CourseCelebrationProps {
  /** Id del curso recién completado (se excluye de las sugerencias). */
  courseId: string;
  /** Título del curso para el copy de celebración. */
  courseTitle: string;
  /** Primera lección del curso: destino de "Repasar desde el inicio". */
  firstLessonId: string | null;
  /** Store de cursos para leer el catálogo de sugerencias. */
  courseStore: CourseStore;
}

export function selectCourseSuggestions(
  courses: CourseRow[],
  currentId: string,
  max = 3
): CourseRow[] {
  return courses
    .filter(
      (c) =>
        c.id !== currentId &&
        c.status === "PUBLISHED" &&
        typeof c.progressPct === "number"
    )
    .sort((a, b) => (a.progressPct ?? -1) - (b.progressPct ?? -1))
    .slice(0, max);
}

export function CourseCelebration({
  courseId,
  courseTitle,
  firstLessonId,
  courseStore,
}: CourseCelebrationProps) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<CourseRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const courses = await courseStore.getCourses();
        if (alive) setSuggestions(selectCourseSuggestions(courses, courseId));
      } catch {
        // Best-effort: sin sugerencias no se rompe la celebración.
      }
    })();
    return () => {
      alive = false;
    };
  }, [courseStore, courseId]);

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <View style={styles.hero}>
          <Award size={48} color={theme.primary} />
          <ThemedText variant="title" style={styles.title}>
            ¡Curso completado!
          </ThemedText>
          <ThemedText variant="body" style={styles.subtitle}>
            Completaste todas las lecciones de {courseTitle}
          </ThemedText>
          <Button
            title="Repasar desde el inicio"
            variant="secondary"
            disabled={!firstLessonId}
            onPress={() => {
              if (!firstLessonId) return;
              router.push({
                pathname: "/cursos/leccion/[id]",
                params: { id: firstLessonId },
              });
            }}
            style={styles.repasar}
          />
        </View>
      </Card>

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          <ThemedText variant="heading" style={styles.suggestionsTitle}>
            Sigue aprendiendo
          </ThemedText>
          <View style={styles.suggestionList}>
            {suggestions.map((c) => (
              <Card
                key={c.id}
                onPress={() =>
                  router.push({ pathname: "/cursos/[id]", params: { id: c.id } })
                }
                accessibilityRole="button"
                accessibilityLabel={`Ver curso ${c.title}`}
              >
                <View style={styles.suggestionRow}>
                  <ThemedText
                    variant="bodyMedium"
                    style={styles.suggestionTitle}
                    numberOfLines={1}
                  >
                    {c.title}
                  </ThemedText>
                  <ThemedText variant="caption" style={styles.suggestionCta}>
                    Ver curso
                  </ThemedText>
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { padding: spacing.xl },
  hero: { alignItems: "center", gap: spacing.sm },
  title: { color: theme.primary, textAlign: "center" },
  subtitle: { color: theme.muted, textAlign: "center" },
  repasar: { alignSelf: "stretch", marginTop: spacing.sm },
  suggestions: { gap: spacing.sm },
  suggestionsTitle: { color: theme.primary },
  suggestionList: { gap: spacing.sm },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  suggestionTitle: { flex: 1, color: theme.text },
  suggestionCta: { color: theme.primary },
});
