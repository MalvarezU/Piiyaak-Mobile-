import { useEffect, useRef, useState } from "react";
import { ScrollView, View, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../../db-context";
import { useAuth } from "../../../auth";
import { apiFetch } from "../../../api";
import { theme, spacing, radiusScale } from "../../../theme";
import { resolveCachedUri } from "../../../db/media-fs";
import type { LessonRow } from "../../../db/course-types";
import { createAudioPlayer, type AudioPlayer } from "../../../audio-player";
import { QuizBlock } from "../../../components/quiz-block";
import { RichTextBlock } from "../../../components/rich-text-block";
import { Screen, ThemedText, Card, Button } from "../../../components/ui";
import { Volume2, Play, BookOpen, CheckCircle2 } from "lucide-react-native";

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
  const [src, setSrc] = useState(url);
  useEffect(() => {
    let alive = true;
    setSrc(url);
    resolveCachedUri({
      wordId: `lesson:${lessonId}`,
      kind: "illustration",
      url,
      sha256: null,
    })
      .then((resolved) => {
        if (alive) setSrc(resolved);
      })
      .catch(() => {});
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
  const [resolved, setResolved] = useState(url);
  useEffect(() => {
    let alive = true;
    setResolved(url);
    resolveCachedUri({
      wordId: `lesson:${lessonId}`,
      kind: "audio",
      url,
      sha256: null,
    })
      .then((r) => {
        if (alive) setResolved(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lessonId, url]);
  return <ListeningPlayer key={resolved} url={resolved} />;
}

interface Block {
  id: string;
  type: string;
  [key: string]: unknown;
}

export default function Leccion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, courseStore } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonRow | null>(null);
  const [completed, setCompleted] = useState(false);
  const [wordMap, setWordMap] = useState<Record<string, { spanish: string; nasaYuwe: string }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store || !courseStore || !id) return;
      const cs = courseStore;
      if (!alive) return;
      const l = await cs.getLesson(String(id));
      if (alive && l) setLesson(l);
      const p = await cs.getProgress(String(id));
      if (alive && p) setCompleted(p.completed);
      // Fetch words for word/vocabulary blocks
      if (alive && l) {
        try {
          const content = JSON.parse(l.content) as { blocks?: { type: string; wordId?: string; wordIds?: string[] }[] };
          const ids = new Set<string>();
          for (const b of content.blocks ?? []) {
            if (b.type === "word" && b.wordId) ids.add(b.wordId);
            if (b.type === "vocabulary" && b.wordIds) b.wordIds.forEach((w) => ids.add(w));
          }
          const wm: Record<string, { spanish: string; nasaYuwe: string }> = {};
          for (const wid of ids) {
            const w = await store?.getById(wid);
            if (w) wm[wid] = { spanish: w.spanish, nasaYuwe: w.nasaYuwe };
          }
          if (alive) setWordMap(wm);
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, courseStore, id]);

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

  let content: { version: number; blocks: Block[] } = { version: 2, blocks: [] };
  try {
    content = JSON.parse(lesson.content);
  } catch {
    // ignore
  }

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText variant="title" style={styles.title}>
            {lesson.title}
          </ThemedText>
        </View>
        {content.blocks.map((block) => (
          <Card key={block.id} style={styles.blockCard}>
            {renderBlock(block, wordMap, String(id))}
          </Card>
        ))}
        <Button
          title={completed ? "Completada" : "Marcar como completada"}
          variant="primary"
          icon={<CheckCircle2 size={18} color={theme.onTint} />}
          onPress={async () => {
            if (!courseStore || !id) return;
            const next = !completed;
            setCompleted(next);
            await courseStore.setProgress(String(id), next, next ? 100 : null);
            if (session) {
              apiFetch("/api/progress", { method: "POST", body: JSON.stringify({ lessonId: id, completed: next }) }, session).catch(() => {
                // queue for later sync
                store?.addOutbox("course_progress", "progress.set", JSON.stringify({ lessonId: id, completed: next })).catch(() => {});
              });
            } else {
              store?.addOutbox("course_progress", "progress.set", JSON.stringify({ lessonId: id, completed: next })).catch(() => {});
            }
          }}
          style={completed ? { backgroundColor: theme.success } : undefined}
        />
        <Button title="Volver" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

function renderBlock(
  block: Block,
  wordMap: Record<string, { spanish: string; nasaYuwe: string }>,
  lessonId: string
) {
  switch (block.type) {
    case "text":
      return <RichTextBlock html={String(block.html ?? "")} />;
    case "image":
      return block.url ? (
        <CachedLessonImage lessonId={lessonId} url={String(block.url)} caption={block.caption ? String(block.caption) : undefined} />
      ) : null;
    case "audio": {
      const mediaUrl = (block.media as { url?: string })?.url;
      return mediaUrl ? <CachedLessonAudio lessonId={lessonId} url={String(mediaUrl)} /> : null;
    }
    case "video":
      return (
        <View style={styles.row}>
          <Play size={18} color={theme.primary} />
          <ThemedText variant="body" style={styles.videoBlock}>
            {String(block.title ?? "")}
          </ThemedText>
        </View>
      );
    case "word": {
      const w = wordMap[String(block.wordId)];
      return (
        <View style={styles.row}>
          <BookOpen size={18} color={theme.montana} />
          <ThemedText variant="body" style={styles.wordBlock}>
            {w ? `${w.spanish} → ${w.nasaYuwe}` : String(block.wordId)}
          </ThemedText>
        </View>
      );
    }
    case "vocabulary": {
      const ids = (block.wordIds as string[]) ?? [];
      return (
        <View style={styles.vocabWrap}>
          <View style={styles.row}>
            <BookOpen size={18} color={theme.montana} />
            <ThemedText variant="body" style={styles.vocabBlock}>
              Vocabulario ({ids.length}):
            </ThemedText>
          </View>
          {ids.map((wid) => {
            const w = wordMap[wid];
            return (
              <ThemedText key={wid} variant="label" style={styles.vocabItem}>
                {w ? `${w.spanish} → ${w.nasaYuwe}` : wid}
              </ThemedText>
            );
          })}
        </View>
      );
    }
    case "quiz": {
      const questions = (block.questions as { prompt: string; options: { text: string; correct: boolean }[]; explanation?: string }[]) ?? [];
      const passScore = typeof block.passScore === "number" ? block.passScore : 70;
      return <QuizBlock questions={questions} passScore={passScore} />;
    }
    case "listening": {
      const opts = (block.options as { text: string; correct: boolean }[]) ?? [];
      const mediaUrl = (block.media as { url?: string })?.url;
      return (
        <View style={styles.listenWrap}>
          {mediaUrl ? <CachedLessonAudio lessonId={lessonId} url={String(mediaUrl)} /> : null}
          <ThemedText variant="bodyStrong" style={styles.listenQ}>
            {String(block.question ?? "")}
          </ThemedText>
          {opts.map((o, j) => (
            <ThemedText key={j} variant="label" style={styles.quizOption}>
              • {o.text}
            </ThemedText>
          ))}
        </View>
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
  header: { gap: spacing.xs },
  title: { color: theme.text },
  blockCard: { gap: spacing.sm },
  imageBlock: { width: "100%", height: 200, borderRadius: radiusScale.md, borderCurve: "continuous" },
  caption: { color: theme.muted, marginTop: spacing.xs, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  videoBlock: { color: theme.primary, flex: 1 },
  wordBlock: { color: theme.text, flex: 1 },
  vocabBlock: { color: theme.text, flex: 1 },
  vocabWrap: { gap: spacing.xs },
  vocabItem: { color: theme.muted, marginLeft: spacing.sm },
  listenWrap: { gap: spacing.sm },
  listenQ: { color: theme.text, marginBottom: spacing.sm },
  quizOption: { color: theme.muted, marginLeft: spacing.sm },
});
