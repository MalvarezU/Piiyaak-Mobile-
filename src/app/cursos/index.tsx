import { useCallback, useEffect, useState } from "react";
import { FlatList, Image, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { GraduationCap, RefreshCw, ArrowRight } from "lucide-react-native";
import { useDb } from "../../db-context";
import { useAuth } from "../../auth";
import { syncCourses, flushCourseProgress } from "../../db/sync-courses";
import { resolveCachedUri } from "../../db/media-fs";
import { EmptyState } from "../../components/empty-state";
import { Screen, ThemedText, Card, Button, Chip } from "../../components/ui";
import { theme, fonts, spacing, radiusScale } from "../../theme";
import type { CourseRow } from "../../db/course-types";

/**
 * Portada con resolución contra el media-cache (B3-03): contenido si está
 * descargado, remota si no. Sin pasado heredado (las portadas nunca se
 * cachearon por `wordId`), por lo que no hay doble lookup.
 */
function CourseCover({ courseId, uri }: { courseId: string; uri: string }) {
  const [src, setSrc] = useState(uri);
  useEffect(() => {
    let alive = true;
    setSrc(uri);
    resolveCachedUri({
      wordId: `course:${courseId}`,
      kind: "illustration",
      url: uri,
      sha256: null,
    })
      .then((resolved) => {
        if (alive) setSrc(resolved);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [courseId, uri]);
  return <Image source={{ uri: src }} style={styles.cover} resizeMode="cover" />;
}

export default function Cursos() {
  const { store, courseStore } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadCourses = useCallback(async () => {
    if (!courseStore) return;
    const cs = await courseStore.getCourses();
    setCourses(cs);
  }, [courseStore]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  const handleSync = async () => {
    if (!courseStore) return;
    setSyncing(true);
    try {
      await syncCourses(courseStore, session);
      if (store && session) {
        await flushCourseProgress(courseStore, store, session);
      }
      await loadCourses();
    } catch (e) {
      console.error("sync courses error", e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText variant="title">Cursos</ThemedText>
        <ThemedText variant="body" style={styles.subtitle}>
          Aprende con lecciones estructuradas
        </ThemedText>
      </View>
      <View style={styles.syncWrap}>
        <Button
          title={syncing ? "Sincronizando..." : "Sincronizar cursos"}
          variant="secondary"
          icon={<RefreshCw size={16} color={theme.primary} />}
          disabled={syncing || !courseStore}
          onPress={handleSync}
          style={styles.syncBtn}
        />
      </View>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <EmptyState
            message="Sin cursos. Sincroniza para descargar."
            icon={<GraduationCap size={48} color={theme.muted} />}
          />
        }
        renderItem={({ item }) => {
          const pct = item.progressPct;
          let chip: { label: string; tone: "neutral" | "success" | "accent" } | null = null;
          if (pct === 100) chip = { label: "Completado", tone: "success" };
          else if (typeof pct === "number" && pct > 0 && pct < 100)
            chip = { label: "En curso", tone: "accent" };
          else if (pct === null) chip = { label: "Sin contenido", tone: "neutral" };

          return (
            <Card
              style={styles.card}
              onPress={() =>
                router.push({ pathname: "/cursos/[id]", params: { id: item.id } })
              }
              accessibilityRole="button"
              accessibilityLabel={item.title}
            >
              <View style={styles.coverWrap}>
                {item.coverImage ? (
                  <CourseCover courseId={item.id} uri={item.coverImage} />
                ) : (
                  <View style={styles.coverPlaceholder}>
                    <GraduationCap size={48} color={theme.muted} />
                  </View>
                )}
                {chip ? (
                  <Chip
                    label={chip.label}
                    tone={chip.tone}
                    style={styles.chip}
                  />
                ) : null}
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardRow}>
                  <View style={styles.cardText}>
                    <ThemedText
                      variant="bodyMedium"
                      style={{ fontFamily: fonts.sansSemibold }}
                      numberOfLines={1}
                    >
                      {item.title}
                    </ThemedText>
                    {item.description ? (
                      <ThemedText
                        variant="caption"
                        numberOfLines={2}
                        style={styles.cardDesc}
                      >
                        {item.description}
                      </ThemedText>
                    ) : null}
                    {typeof pct === "number" && pct > 0 ? (
                      <View style={styles.progressTrack}>
                        <View
                          style={[
                            styles.progressFill,
                            { width: `${pct}%` },
                          ]}
                        />
                      </View>
                    ) : null}
                  </View>
                  <ArrowRight size={18} color={theme.muted} />
                </View>
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  subtitle: { color: theme.muted },
  syncWrap: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  syncBtn: {
    width: "100%",
  },
  list: { flex: 1, marginTop: spacing.sm },
  listContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  card: {
    padding: 0,
    overflow: "hidden",
  },
  coverWrap: {
    position: "relative",
    width: "100%",
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  coverPlaceholder: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: theme.successSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
  },
  cardBody: {
    padding: spacing.md,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardDesc: {
    color: theme.muted,
  },
  progressTrack: {
    height: 6,
    borderRadius: radiusScale.full,
    backgroundColor: theme.successSoft,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.primary,
  },
});