import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, TextInput, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { GraduationCap, RefreshCw, ArrowRight, Search, X } from "lucide-react-native";
import { useDb } from "../../db-context";
import { useAuth, AUTH_UI_ENABLED } from "../../auth";
import { syncCourses, flushCourseProgress } from "../../db/sync-courses";
import { resolveCachedUri } from "../../db/media-fs";
import { toAbsoluteUrl } from "../../api";
import { EmptyState } from "../../components/empty-state";
import { Screen, ThemedText, Card, Button, Chip } from "../../components/ui";
import { theme, fonts, spacing, radiusScale, type, minHit } from "../../theme";
import type { CourseRow } from "../../db/course-types";

/**
 * Portada con resolución contra el media-cache (B3-03): contenido si está
 * descargado, remota si no. Sin pasado heredado (las portadas nunca se
 * cachearon por `wordId`), por lo que no hay doble lookup.
 */
function CourseCover({ courseId, uri }: { courseId: string; uri: string }) {
  const [src, setSrc] = useState(() => toAbsoluteUrl(uri));
  useEffect(() => {
    let alive = true;
    const abs = toAbsoluteUrl(uri);
    setSrc(abs);
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

/** Normalización de búsqueda: NFD + strip diacríticos + lowercase (parity web). */
function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Filtro cliente por título y descripción, con la query ya normalizada. */
function courseMatches(course: CourseRow, query: string): boolean {
  return (
    normalizeSearchText(course.title).includes(query) ||
    normalizeSearchText(course.description ?? "").includes(query)
  );
}

type ChipTone = "neutral" | "success" | "accent";

/** Chip de estado del curso (misma lógica que las cards del catálogo). */
function getCourseChip(
  pct: number | null | undefined
): { label: string; tone: ChipTone } | null {
  if (pct === 100) return { label: "Completado", tone: "success" };
  if (typeof pct === "number" && pct > 0 && pct < 100)
    return { label: "En curso", tone: "accent" };
  if (pct === null) return { label: "Sin contenido", tone: "neutral" };
  return null;
}

interface ResumeNextLesson {
  id: string;
  title: string;
  moduleIndex: number;
  lessonNumber: string | null;
}

interface ResumeState {
  course: CourseRow;
  next: ResumeNextLesson | null;
  firstLessonId: string | null;
  pct: number;
}

/**
 * Tira de "continuar donde quedaste": eyebrow que explica la banda, título
 * serif protagonista, posición actual y CTA hacia la próxima lección pendiente.
 * Paridad del ResumeBand web (colapsada a una columna en móvil).
 */
function ResumeBand({
  course,
  next,
  pct,
  onContinue,
}: {
  course: CourseRow;
  next: ResumeNextLesson | null;
  pct: number;
  onContinue: () => void;
}) {
  const continues = next
    ? `Módulo ${next.moduleIndex} · sigue con ${
        next.lessonNumber !== null && next.lessonNumber !== undefined
          ? `${next.moduleIndex}.${next.lessonNumber} `
          : ""
      }${next.title}`
    : "Curso completado · repasá desde el inicio";

  return (
    <Card style={styles.resumeBand} accessibilityLabel={`Continuar ${course.title}`}>
      <View style={styles.resumeText}>
        <ThemedText variant="caption" style={styles.eyebrow}>
          RETOMAR CURSO
        </ThemedText>
        <ThemedText variant="title" numberOfLines={1}>
          {course.title}
        </ThemedText>
        <ThemedText variant="body" style={styles.muted} numberOfLines={1}>
          {continues}
        </ThemedText>
        <ThemedText variant="caption" style={styles.pct}>
          {pct}% completado
        </ThemedText>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
      <Button
        title={next ? "Continuar" : "Repasar"}
        variant="primary"
        icon={<ArrowRight size={16} color={theme.onTint} />}
        onPress={onContinue}
        style={styles.resumeBtn}
      />
    </Card>
  );
}

/**
 * Curso sugerido (F-E5): portada a ancho con chip y cuerpo con meta. Ocupa
 * más altura que las cards del catálogo (título serif, descripción a 3 líneas
 * y progress con etiqueta). Toda la card es táctil hacia el detalle.
 */
function FeaturedCourseCard({
  course,
  onPress,
}: {
  course: CourseRow;
  onPress: () => void;
}) {
  const pct = course.progressPct;
  const chip = getCourseChip(pct);
  return (
    <Card
      style={styles.featured}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={course.title}
    >
      <View style={styles.coverWrap}>
        {course.coverImage ? (
          <CourseCover courseId={course.id} uri={course.coverImage} />
        ) : (
          <View style={styles.coverPlaceholder}>
            <GraduationCap size={64} color={theme.muted} />
          </View>
        )}
        {chip ? (
          <Chip label={chip.label} tone={chip.tone} style={styles.chip} />
        ) : null}
      </View>
      <View style={styles.featuredBody}>
        <ThemedText variant="title" numberOfLines={2}>
          {course.title}
        </ThemedText>
        {course.description ? (
          <ThemedText variant="body" style={styles.muted} numberOfLines={3}>
            {course.description}
          </ThemedText>
        ) : null}
        {typeof pct === "number" && pct > 0 ? (
          <View style={styles.featuredProgress}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <ThemedText variant="caption" style={styles.pct}>
              {pct}% completado
            </ThemedText>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function Cursos() {
  const { store, courseStore } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [resume, setResume] = useState<ResumeState | null>(null);

  const loadCourses = useCallback(async () => {
    if (!courseStore) return;
    const cs = await courseStore.getCourses();
    setCourses(cs);
  }, [courseStore]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  // Auto-sync al entrar a la pestaña: los cursos se cargan solos sin
  // depender del botón. Corre una sola vez por montaje (ref anti-doble).
  const autoSyncedRef = useRef(false);
  useEffect(() => {
    if (!courseStore || autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    (async () => {
      setSyncing(true);
      setSyncError(null);
      try {
        await syncCourses(courseStore, session);
        if (store && session) {
          await flushCourseProgress(courseStore, store, session);
        }
        await loadCourses();
      } catch {
        setSyncError("No se pudo sincronizar. Revisá la conexión e intentá de nuevo.");
      } finally {
        setSyncing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseStore]);

  // Banda de continuación: el curso con mayor avance (>0). La próxima lección
  // es la primera no completada recorriendo módulos→lecciones en orden.
  useEffect(() => {
    let alive = true;
    if (!courseStore || courses.length === 0) {
      setResume(null);
      return;
    }
    const best = courses
      .filter((c) => typeof c.progressPct === "number" && c.progressPct > 0)
      .sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0))[0];
    if (!best) {
      setResume(null);
      return;
    }
    (async () => {
      try {
        const progress = await courseStore.getAllProgress();
        const completed = new Set(
          progress.filter((p) => p.completed).map((p) => p.lessonId)
        );
        const modules = await courseStore.getModules(best.id);
        let first: ResumeNextLesson | null = null;
        let next: ResumeNextLesson | null = null;
        for (let mi = 0; mi < modules.length && !next; mi++) {
          const mod = modules[mi];
          if (!mod) continue;
          const lessons = await courseStore.getLessons(mod.id);
          for (const lesson of lessons) {
            const entry: ResumeNextLesson = {
              id: lesson.id,
              title: lesson.title,
              moduleIndex: mi + 1,
              lessonNumber: lesson.lessonNumber,
            };
            if (!first) first = entry;
            if (!completed.has(lesson.id)) {
              next = entry;
              break;
            }
          }
        }
        if (alive) {
          setResume({
            course: best,
            next,
            firstLessonId: first?.id ?? null,
            pct: best.progressPct ?? 0,
          });
        }
      } catch (e) {
        console.error("resolve resume error", e);
        if (alive) {
          setResume({
            course: best,
            next: null,
            firstLessonId: null,
            pct: best.progressPct ?? 0,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [courses, courseStore]);

  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    if (!courseStore) return;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncCourses(courseStore, session);
      if (store && session) {
        await flushCourseProgress(courseStore, store, session);
      }
      await loadCourses();
    } catch {
      setSyncError("No se pudo sincronizar. Revisá la conexión e intentá de nuevo.");
    } finally {
      setSyncing(false);
    }
  };

  const normalizedQuery = normalizeSearchText(query.trim());
  const isSearching = normalizedQuery.length > 0;
  const published = courses;
  // Decisión editorial web: el curso más reciente publicado (último de la
  // lista). El store del app ordena por título, no por createdAt.
  const featured = published.length > 0 ? published[published.length - 1] : null;
  // Con query activa TODO el catálogo entra al grid (incluido el destacado);
  // sin query el destacado vive como portada y se excluye del listado.
  const catalogData = isSearching
    ? published.filter((c) => courseMatches(c, normalizedQuery))
    : featured
      ? published.filter((c) => c.id !== featured.id)
      : published;

  const goToResume = () => {
    if (!resume) return;
    if (resume.next) {
      router.push({
        pathname: "/cursos/leccion/[id]",
        params: { id: resume.next.id },
      });
    } else if (resume.firstLessonId) {
      router.push({
        pathname: "/cursos/leccion/[id]",
        params: { id: resume.firstLessonId },
      });
    } else {
      router.push({ pathname: "/cursos/[id]", params: { id: resume.course.id } });
    }
  };

  return (
    <Screen>
      <FlatList
        data={catalogData}
        keyExtractor={(c) => c.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* Hero editorial: título serif + descripción + CTA + aviso anónimo. */}
            <View style={styles.hero}>
              <View style={styles.heroTitleRow}>
                <GraduationCap size={28} color={theme.primary} />
                <ThemedText variant="display" style={styles.heroTitle}>
                  Cursos
                </ThemedText>
              </View>
              <ThemedText variant="body" style={styles.heroDesc}>
                Sigue una ruta estructurada para aprender Nasa Yuwe paso a paso.
                Cada curso está organizado en módulos y lecciones que puedes
                completar a tu ritmo.
              </ThemedText>
              <View style={styles.heroActions}>
                {resume ? (
                  <Button
                    title="Retomar donde quedaste"
                    variant="primary"
                    icon={<ArrowRight size={16} color={theme.onTint} />}
                    onPress={goToResume}
                    style={styles.heroCta}
                  />
                ) : null}
                {!session && AUTH_UI_ENABLED ? (
                  <Chip
                    label="Sin sesión: tu progreso vive en este dispositivo"
                    tone="neutral"
                  />
                ) : null}
              </View>
            </View>

            {!isSearching && resume ? (
              <ResumeBand
                course={resume.course}
                next={resume.next}
                pct={resume.pct}
                onContinue={goToResume}
              />
            ) : null}

            {!isSearching && featured ? (
              <FeaturedCourseCard
                course={featured}
                onPress={() =>
                  router.push({
                    pathname: "/cursos/[id]",
                    params: { id: featured.id },
                  })
                }
              />
            ) : null}

            {/* Buscador: filtro cliente sobre el catálogo ya cargado. */}
            <View style={styles.searchWrap}>
              <Search size={16} color={theme.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar curso..."
                placeholderTextColor={theme.muted}
                style={styles.searchInput}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                accessibilityLabel="Buscar cursos"
              />
              {query ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Limpiar búsqueda"
                  onPress={() => setQuery("")}
                  style={({ pressed }) => [
                    styles.clearBtn,
                    pressed ? styles.clearPressed : null,
                  ]}
                >
                  <X size={16} color={theme.muted} />
                </Pressable>
              ) : null}
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
              {syncError ? (
                <ThemedText variant="caption" style={styles.syncError}>
                  {syncError}
                </ThemedText>
              ) : null}
            </View>
          </View>
        }
        ListEmptyComponent={
          isSearching ? (
            <EmptyState
              message="Sin cursos que coincidan."
              icon={<Search size={48} color={theme.muted} />}
            />
          ) : (
            <EmptyState
              message="Sin cursos. Sincroniza para descargar."
              icon={<GraduationCap size={48} color={theme.muted} />}
            />
          )
        }
        renderItem={({ item }) => {
          const pct = item.progressPct;
          const chip = getCourseChip(pct);

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
  list: { flex: 1 },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  hero: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  heroTitle: { color: theme.primary },
  heroDesc: { color: theme.muted },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  heroCta: { alignSelf: "flex-start" },
  resumeBand: {
    gap: spacing.md,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
  },
  resumeText: { gap: spacing.xs },
  eyebrow: {
    color: theme.muted,
    textTransform: "uppercase",
  },
  muted: { color: theme.muted },
  pct: {
    color: theme.muted,
    fontVariant: ["tabular-nums"],
  },
  resumeBtn: { width: "100%" },
  featured: {
    padding: 0,
    overflow: "hidden",
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
  },
  featuredBody: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  featuredProgress: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minHit,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radiusScale.full,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
  },
  searchInput: {
    ...type.body,
    flex: 1,
    paddingVertical: 0,
  },
  clearBtn: {
    width: minHit,
    height: minHit,
    alignItems: "center",
    justifyContent: "center",
  },
  clearPressed: { opacity: 0.6 },
  syncWrap: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  syncBtn: {
    width: "100%",
  },
  syncError: {
    color: theme.danger,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  card: {
    padding: 0,
    overflow: "hidden",
    marginHorizontal: spacing.md,
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
