import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View, StyleSheet, Image, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../../db-context";
import { useAuth } from "../../../auth";
import { apiFetch, toAbsoluteUrl } from "../../../api";
import { theme, spacing, radiusScale, fonts } from "../../../theme";
import { resolveCachedUri } from "../../../db/media-fs";
import { resolveAudioUri, resolveBundledAudioUri } from "../../../audio";
import { resolveBundledIllustrationUri } from "../../../illustrations";
import type { CourseRow, LessonRow, CourseProgressRow } from "../../../db/course-types";
import type { CourseStore } from "../../../db/course-store";
import type { WordRow } from "../../../db/types";
import { createAudioPlayer, type AudioPlayer } from "../../../audio-player";
import { QuizBlock } from "../../../components/quiz-block";
import { ListeningBlock } from "../../../components/listening-block";
import { RichTextBlock } from "../../../components/rich-text-block";
import { Screen, ThemedText, Card, Button, Chip } from "../../../components/ui";
import { Volume2, Play, CheckCircle2, ArrowLeft, ArrowRight } from "lucide-react-native";

function ListeningPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedRef = useRef(false);

  const toggle = async () => {
    if (!playerRef.current) playerRef.current = createAudioPlayer();
    const player = playerRef.current;
    if (loadedRef.current) {
      if (playing) {
        await player.pause();
        setPlaying(false);
      } else {
        await player.seekTo(0);
        await player.play();
        setPlaying(true);
      }
      return;
    }
    try {
      await player.load(url, () => setPlaying(false));
      loadedRef.current = true;
      await player.play();
      setPlaying(true);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    return () => {
      loadedRef.current = false;
      playerRef.current?.unload().catch(() => {});
    };
  }, []);

  return (
    <Button
      title={playing ? "Pausar audio" : "Reproducir audio"}
      variant="secondary"
      icon={<Volume2 size={18} color={theme.primary} />}
      onPress={toggle}
    />
  );
}

function CachedLessonImage({
  lessonId,
  url,
  caption,
}: {
  lessonId: string;
  url: string;
  caption?: string;
}) {
  const [src, setSrc] = useState(() => toAbsoluteUrl(url));
  useEffect(() => {
    let alive = true;
    const abs = toAbsoluteUrl(url);
    setSrc(abs);
    (async () => {
      // Puente offline primero: si la imagen viaja embebida en la APK
      // (assets/illustrations, match por basename), no depende de red.
      const bundled = await resolveBundledIllustrationUri(url);
      if (alive && bundled) {
        setSrc(bundled);
        return;
      }
      // Clave de cache con la URL cruda: lessonBlocksToRefs construye el
      // ref igual (parity con populateMediaCache).
      const resolved = await resolveCachedUri({
        wordId: `lesson:${lessonId}`,
        kind: "illustration",
        url,
        sha256: null,
      });
      if (alive) setSrc(resolved);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [lessonId, url]);
  return (
    <View>
      <Image source={{ uri: src }} style={styles.imageBlock} resizeMode="cover" />
      {caption ? (
        <ThemedText variant="caption" style={styles.caption}>
          {caption}
        </ThemedText>
      ) : null}
    </View>
  );
}

function CachedLessonAudio({ lessonId, url }: { lessonId: string; url: string }) {
  const [resolved, setResolved] = useState(() => toAbsoluteUrl(url));
  useEffect(() => {
    let alive = true;
    const abs = toAbsoluteUrl(url);
    setResolved(abs);
    (async () => {
      // Puente offline primero: el audio del bloque viaja embebido en la
      // APK (match por sufijo del basename); si no está, cache; remota
      // como último recurso (online).
      const bundled = await resolveBundledAudioUri(url);
      if (alive && bundled) {
        setResolved(bundled);
        return;
      }
      const r = await resolveCachedUri({
        wordId: `lesson:${lessonId}`,
        kind: "audio",
        url,
        sha256: null,
      });
      if (alive) setResolved(r);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [lessonId, url]);
  return <ListeningPlayer key={resolved} url={resolved} />;
}

/**
 * Botón de audio de una ficha de palabra. Resuelve por contenido
 * (`resolveAudioUri`: caché → heredado → bundled → remoto) y alterna
 * play/pausa con el adaptador de audio. Best-effort: sin caché offline el
 * botón queda en "Reproducir audio".
 */
function WordAudioButton({ word }: { word: WordRow }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    return () => {
      loadedRef.current = false;
      playerRef.current?.unload().catch(() => {});
    };
  }, []);

  const toggle = async () => {
    if (!word.audioUrl || loading) return;
    if (!playerRef.current) playerRef.current = createAudioPlayer();
    const player = playerRef.current;
    if (loadedRef.current) {
      if (playing) {
        await player.pause();
        setPlaying(false);
      } else {
        await player.seekTo(0);
        await player.play();
        setPlaying(true);
      }
      return;
    }
    setLoading(true);
    try {
      const uri = await resolveAudioUri({
        id: word.id,
        audioUrl: word.audioUrl,
        audioSha256: word.audioSha256 ?? null,
      });
      await player.load(uri, () => setPlaying(false));
      loadedRef.current = true;
      await player.play();
      setPlaying(true);
    } catch {
      // offline sin caché: no hay audio
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      title={loading ? "Cargando audio..." : playing ? "Pausar audio" : "Reproducir audio"}
      variant="secondary"
      icon={<Volume2 size={18} color={theme.primary} />}
      onPress={() => void toggle()}
      disabled={loading}
    />
  );
}

/**
 * Ficha de palabra (paridad web `BlockWordCard`): nasaYuwe en serif,
 * traducción, categoría, pronunciación, audio y contexto cultural. Si la
 * palabra no está disponible, un estado vacío claro en vez de romper la
 * lección.
 */
function WordCard({ word, fallbackLabel }: { word: WordRow | null; fallbackLabel?: string }) {
  if (!word) {
    return (
      <View style={styles.wordMissing}>
        <ThemedText variant="label" style={styles.mutedText}>
          {fallbackLabel ?? "Palabra no disponible"}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.wordCard}>
      <View style={styles.wordHeader}>
        <ThemedText variant="bodyMedium" style={styles.wordNasa}>
          {word.nasaYuwe}
        </ThemedText>
        <ThemedText variant="label" style={styles.wordSpanish}>
          {word.spanish}
        </ThemedText>
        {word.category ? <Chip label={word.category} tone="accent" /> : null}
      </View>
      {word.pronunciation ? (
        <ThemedText variant="caption" style={styles.wordPron}>
          {`[ ${word.pronunciation} ]`}
        </ThemedText>
      ) : null}
      {word.audioUrl ? <WordAudioButton word={word} /> : null}
      {word.culturalContext ? (
        <ThemedText variant="body" style={styles.wordContext}>
          {word.culturalContext}
        </ThemedText>
      ) : null}
    </View>
  );
}

interface Block {
  id: string;
  type: string;
  [key: string]: unknown;
}

/** Lección aplanada con su módulo (la navegación cruza módulos). */
interface LeccionNav {
  id: string;
  title: string;
  moduleIndex: number;
  moduleTitle: string;
  number: string | null;
  /** Posición 1-based dentro del módulo (respaldo sin numeración legacy). */
  position: number;
}

interface NavData {
  course: CourseRow | null;
  lista: LeccionNav[];
  indice: number;
  progressMap: Record<string, CourseProgressRow>;
}

/**
 * Busca el curso de una lección y arma la lista aplanada. `LessonRow` no
 * guarda `courseId`, así que se recorren los cursos hasta encontrar el módulo
 * dueño de la lección. Costo: una consulta `getModules` por curso (N) + una
 * `getLessons` por módulo del curso encontrado; aceptable con menos de 50
 * cursos y sin índice invertido en `modules.courseId`.
 */
async function cargarNavegacion(cs: CourseStore, lesson: LessonRow): Promise<NavData | null> {
  const courseIds = await cs.listCourseIds();
  for (const courseId of courseIds) {
    const modules = await cs.getModules(courseId);
    const moduleIndex = modules.findIndex((m) => m.id === lesson.moduleId);
    if (moduleIndex === -1) continue;
    const [course, progressRows] = await Promise.all([cs.getCourse(courseId), cs.getAllProgress()]);
    const progressMap: Record<string, CourseProgressRow> = {};
    for (const p of progressRows) progressMap[p.lessonId] = p;
    const lista: LeccionNav[] = [];
    for (let mi = 0; mi < modules.length; mi++) {
      const mod = modules[mi];
      if (!mod) continue;
      const lessons = await cs.getLessons(mod.id);
      for (let li = 0; li < lessons.length; li++) {
        const l = lessons[li];
        if (!l) continue;
        lista.push({
          id: l.id,
          title: l.title,
          moduleIndex: mi,
          moduleTitle: mod.title,
          number: l.lessonNumber,
          position: li + 1,
        });
      }
    }
    return { course, lista, indice: lista.findIndex((l) => l.id === lesson.id), progressMap };
  }
  return null;
}

/** Trae las palabras completas referenciadas por los bloques word/vocabulary. */
async function cargarPalabras(
  store: { getById: (id: string) => Promise<WordRow | null> } | null,
  lesson: LessonRow
): Promise<Record<string, WordRow>> {
  const wm: Record<string, WordRow> = {};
  if (!store) return wm;
  try {
    const parsed = JSON.parse(lesson.content) as {
      blocks?: { type: string; wordId?: string; wordIds?: string[] }[];
    };
    const ids = new Set<string>();
    for (const b of parsed.blocks ?? []) {
      if (b.type === "word" && b.wordId) ids.add(b.wordId);
      if (b.type === "vocabulary" && b.wordIds) b.wordIds.forEach((w) => ids.add(w));
    }
    for (const wid of ids) {
      const w = await store.getById(wid);
      if (w) wm[wid] = w;
    }
  } catch {
    // contenido inválido: sin palabras
  }
  return wm;
}

export default function Leccion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, courseStore } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonRow | null>(null);
  const [completed, setCompleted] = useState(false);
  const [wordMap, setWordMap] = useState<Record<string, WordRow>>({});
  const [nav, setNav] = useState<NavData | null>(null);
  // Aprobación por bloque interactivo: { [bloqueId]: score }. La lección se
  // completa cuando TODOS los interactivos tienen score.
  const [aprobados, setAprobados] = useState<Record<string, number>>({});
  const avisoEnviado = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store || !courseStore || !id) return;
      const cs = courseStore;
      const l = await cs.getLesson(String(id));
      if (!alive) return;
      if (l) setLesson(l);
      const p = await cs.getProgress(String(id));
      if (alive && p) setCompleted(p.completed);
      if (l) {
        const [wm, navData] = await Promise.all([
          cargarPalabras(store, l),
          cargarNavegacion(cs, l),
        ]);
        if (!alive) return;
        setWordMap(wm);
        if (navData) setNav(navData);
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, courseStore, id]);

  // El componente se reutiliza al navegar con otro `id`: la aprobación por
  // bloque y el aviso de completado pertenecen a la lección anterior.
  useEffect(() => {
    setAprobados({});
    avisoEnviado.current = false;
  }, [id]);

  const content = useMemo(() => {
    if (!lesson) return { version: 2, blocks: [] as Block[] };
    try {
      const parsed = JSON.parse(lesson.content) as { version?: number; blocks?: Block[] };
      return { version: parsed.version ?? 2, blocks: parsed.blocks ?? [] };
    } catch {
      return { version: 2, blocks: [] as Block[] };
    }
  }, [lesson]);

  const interactivos = useMemo(
    () => content.blocks.filter((b) => b.type === "quiz" || b.type === "listening"),
    [content]
  );
  const todosAprobados =
    interactivos.length > 0 && interactivos.every((b) => aprobados[b.id] !== undefined);

  /**
   * Completar la lección (paridad web `onCompleta`): guarda el progreso
   * local con el score y lo sincroniza por API/outbox. Score nulo = completado
   * a mano (sin actividad); si no hay actividad, la lección se marca sin
   * score. Es la misma vía que ya usaba el botón manual.
   */
  const completarLeccion = useCallback(
    async (score: number | null) => {
      if (!courseStore || !id) return;
      const lessonId = String(id);
      const now = new Date().toISOString();
      setCompleted(true);
      setNav((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          progressMap: {
            ...prev.progressMap,
            [lessonId]: {
              lessonId,
              completed: true,
              score,
              lastVisitedAt: now,
              completedAt: now,
            },
          },
        };
      });
      await courseStore.setProgress(lessonId, true, score);
      const payload = JSON.stringify({ lessonId, completed: true, score });
      if (session) {
        apiFetch("/api/progress", { method: "POST", body: payload }, session).catch(() => {
          store?.addOutbox("course_progress", "progress.set", payload).catch(() => {});
        });
      } else {
        store?.addOutbox("course_progress", "progress.set", payload).catch(() => {});
      }
    },
    [courseStore, id, session, store]
  );

  // Cuando todos los interactivos están aprobados, se completa una sola vez.
  // `lesson.id !== id` evita disparar con la lección anterior durante el
  // intercambio de params.
  useEffect(() => {
    if (!lesson || lesson.id !== id) return;
    if (!todosAprobados || avisoEnviado.current) return;
    avisoEnviado.current = true;
    const scores = Object.values(aprobados);
    const maxScore = scores.length > 0 ? Math.max(...scores) : null;
    void completarLeccion(maxScore);
  }, [lesson, id, todosAprobados, aprobados, completarLeccion]);

  if (!lesson) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ThemedText variant="body" style={styles.muted}>
            Cargando lección...
          </ThemedText>
        </View>
      </Screen>
    );
  }

  const actual = nav && nav.indice >= 0 ? nav.lista[nav.indice] : undefined;
  const prev = nav && nav.indice > 0 ? nav.lista[nav.indice - 1] : undefined;
  const next =
    nav && nav.indice >= 0 && nav.indice < nav.lista.length - 1
      ? nav.lista[nav.indice + 1]
      : undefined;

  // Desbloqueo secuencial (paridad web `isModuleUnlocked`): el módulo 0
  // siempre abre; los demás exigen el módulo anterior completo. Sin
  // `sequential`, todo está abierto.
  const moduloDesbloqueado = (moduleIndex: number): boolean => {
    if (!nav?.course?.sequential || moduleIndex === 0) return true;
    const prevLessons = nav.lista.filter((l) => l.moduleIndex === moduleIndex - 1);
    if (prevLessons.length === 0) return false;
    return prevLessons.every((l) => nav.progressMap[l.id]?.completed === true);
  };

  const marcarAprobado = (blockId: string, score: number) => {
    setAprobados((prev) => ({ ...prev, [blockId]: score }));
  };

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          {actual ? (
            <ThemedText variant="caption" style={styles.position}>
              {`Módulo ${actual.moduleIndex + 1} · Lección ${actual.number || actual.position}`}
            </ThemedText>
          ) : null}
          <ThemedText variant="title" style={styles.title}>
            {lesson.title}
          </ThemedText>
        </View>
        {content.blocks.map((block) => (
          <Card key={block.id} style={styles.blockCard}>
            {renderBlock(block, wordMap, String(id), marcarAprobado)}
          </Card>
        ))}
        {completed ? (
          <Button
            title="Completada"
            variant="primary"
            icon={<CheckCircle2 size={18} color={theme.onTint} />}
            onPress={() => {}}
            disabled
            style={styles.completed}
          />
        ) : interactivos.length === 0 ? (
          <Button
            title="Marcar como completada"
            variant="primary"
            icon={<CheckCircle2 size={18} color={theme.onTint} />}
            onPress={() => void completarLeccion(null)}
          />
        ) : null}
        <View style={styles.navRow}>
          <Button
            title="Anterior"
            variant="secondary"
            icon={<ArrowLeft size={18} color={theme.primary} />}
            disabled={!prev || !moduloDesbloqueado(prev.moduleIndex)}
            onPress={() => {
              if (prev) {
                router.push({ pathname: "/cursos/leccion/[id]", params: { id: prev.id } });
              }
            }}
            style={styles.navButton}
          />
          <Button
            title="Siguiente"
            variant="primary"
            icon={<ArrowRight size={18} color={theme.onTint} />}
            disabled={!next || !moduloDesbloqueado(next.moduleIndex)}
            onPress={() => {
              if (next) {
                router.push({ pathname: "/cursos/leccion/[id]", params: { id: next.id } });
              }
            }}
            style={styles.navButton}
          />
        </View>
        <Button title="Volver" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function renderBlock(
  block: Block,
  wordMap: Record<string, WordRow>,
  lessonId: string,
  onAprobado: (id: string, score: number) => void
) {
  switch (block.type) {
    case "text":
      return <RichTextBlock html={String(block.html ?? "")} />;
    case "image":
      return block.url ? (
        <CachedLessonImage
          lessonId={lessonId}
          url={String(block.url)}
          caption={block.caption ? String(block.caption) : undefined}
        />
      ) : null;
    case "audio": {
      const mediaUrl = (block.media as { url?: string })?.url;
      return mediaUrl ? <CachedLessonAudio lessonId={lessonId} url={String(mediaUrl)} /> : null;
    }
    case "video": {
      const youtubeId = typeof block.youtubeId === "string" ? block.youtubeId : "";
      const mediaUrl = (block.media as { url?: string })?.url;
      const title = String(block.title ?? "");
      if (youtubeId) {
        return (
          <View style={styles.videoCard}>
            <View style={styles.row}>
              <Play size={18} color={theme.primary} />
              <ThemedText variant="bodyMedium" style={styles.videoTitle}>
                {title}
              </ThemedText>
            </View>
            <ThemedText variant="caption" style={styles.mutedText}>
              Este video solo está disponible con conexión.
            </ThemedText>
            <Button
              title="Abrir en YouTube"
              variant="secondary"
              onPress={() => {
                Linking.openURL(`https://www.youtube.com/watch?v=${youtubeId}`).catch(() => {});
              }}
            />
          </View>
        );
      }
      if (mediaUrl) {
        return (
          <ThemedText variant="caption" style={styles.mutedText}>
            Los videos subidos no están disponibles en la app aún.
          </ThemedText>
        );
      }
      return null;
    }
    case "word": {
      const wid = String(block.wordId ?? "");
      return <WordCard word={wordMap[wid] ?? null} fallbackLabel="Palabra no disponible" />;
    }
    case "vocabulary": {
      const ids = (block.wordIds as string[]) ?? [];
      return (
        <View style={styles.vocabWrap}>
          {ids.map((wid) => (
            <WordCard
              key={wid}
              word={wordMap[wid] ?? null}
              fallbackLabel={`Palabra no disponible (id ${wid})`}
            />
          ))}
        </View>
      );
    }
    case "quiz": {
      const questions =
        (block.questions as {
          prompt: string;
          options: { text: string; correct: boolean }[];
          explanation?: string;
        }[]) ?? [];
      const passScore = typeof block.passScore === "number" ? block.passScore : 70;
      return (
        <QuizBlock
          questions={questions}
          passScore={passScore}
          onAprobado={(score) => onAprobado(block.id, score)}
        />
      );
    }
    case "listening": {
      const opts = (block.options as { text: string; correct: boolean }[]) ?? [];
      const mediaUrl = (block.media as { url?: string })?.url ?? null;
      return (
        <ListeningBlock
          question={String(block.question ?? "")}
          options={opts}
          mediaUrl={mediaUrl}
          audioKey={lessonId}
          onAprobado={(score) => onAprobado(block.id, score)}
        />
      );
    }
    default:
      return (
        <ThemedText variant="caption" style={styles.muted}>
          Bloque: {block.type}
        </ThemedText>
      );
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  muted: { color: theme.muted, textAlign: "center", marginTop: spacing.xl },
  mutedText: { color: theme.muted },
  header: { gap: spacing.xs },
  position: { color: theme.muted },
  title: { color: theme.text },
  blockCard: { gap: spacing.sm },
  imageBlock: { width: "100%", height: 200, borderRadius: radiusScale.md, borderCurve: "continuous" },
  caption: { color: theme.muted, marginTop: spacing.xs, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  videoCard: { gap: spacing.sm },
  videoTitle: { color: theme.text, flex: 1 },
  wordCard: {
    gap: spacing.sm,
    backgroundColor: theme.background,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing.md,
  },
  wordMissing: {
    backgroundColor: theme.background,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing.md,
  },
  wordHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  wordNasa: { color: theme.montana, fontFamily: fonts.serifSemibold },
  wordSpanish: { color: theme.muted, flexShrink: 1 },
  wordPron: { color: theme.muted },
  wordContext: { color: theme.text },
  vocabWrap: { gap: spacing.sm },
  navRow: { flexDirection: "row", gap: spacing.sm },
  navButton: { flex: 1 },
  completed: { backgroundColor: theme.success, opacity: 1 },
});
