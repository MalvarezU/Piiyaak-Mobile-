import { useEffect, useRef, useState } from "react";
import { createAudioPlayer, type AudioPlayer } from "../../../audio-player";
import { QuizBlock } from "../../../components/quiz-block";
import { RichTextBlock } from "../../../components/rich-text-block";

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
    <TouchableOpacity style={styles.audioBtn} onPress={toggle}>
      <Text style={styles.audioBtnText}>{playing ? "⏸ Pausar audio" : "▶ Reproducir audio"}</Text>
    </TouchableOpacity>
  );
}
import { ScrollView, Text, TouchableOpacity, View, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../../db-context";
import { useAuth } from "../../../auth";
import { apiFetch } from "../../../api";
import { theme } from "../../../theme";
import { resolveCachedUri } from "../../../db/media-fs";
import type { LessonRow } from "../../../db/course-types";
import type { CourseProgressRow } from "../../../db/course-types";

/**
 * Bloques de medios con resolución contra el media-cache (B3-03, spec §3.1):
 * `image` y `audio`/`listening` usan la clave `lesson:<id>`; sin pasado
 * heredado, por lo que resuelven contenido → remoto. Video/youtubeId quedan
 * excluidos (spec §3.2) y conservan el comportamiento actual.
 */
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
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

function CachedLessonAudio({
  lessonId,
  url,
}: {
  lessonId: string;
  url: string;
}) {
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
          const content = JSON.parse(l.content) as { blocks?: Array<{ type: string; wordId?: string; wordIds?: string[] }> };
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
    return () => { alive = false; };
  }, [store, courseStore, id]);

  if (!lesson) {
    return <View style={styles.root}><Text style={styles.muted}>Cargando lección...</Text></View>;
  }

  let content: { version: number; blocks: Block[] } = { version: 2, blocks: [] };
  try {
    content = JSON.parse(lesson.content);
  } catch {
    // ignore
  }

  return (
    <ScrollView style={styles.root}>
      <Text style={styles.title}>{lesson.title}</Text>
      {content.blocks.map((block) => (
        <View key={block.id} style={styles.block}>
          {renderBlock(block, wordMap, String(id))}
        </View>
      ))}
      <TouchableOpacity
        style={[styles.btn, completed ? styles.btnDone : null]}
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
      >
        <Text style={styles.btnText}>{completed ? "✓ Completada" : "Marcar como completada"}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
        <Text style={styles.btnText}>Volver</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function renderBlock(block: Block, wordMap: Record<string, { spanish: string; nasaYuwe: string }>, lessonId: string) {
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
      return mediaUrl ? (
        <CachedLessonAudio lessonId={lessonId} url={String(mediaUrl)} />
      ) : null;
    }
    case "video":
      return <Text style={styles.videoBlock}>🎬 Video: {String(block.title ?? "")}</Text>;
    case "word": {
      const w = wordMap[String(block.wordId)];
      return <Text style={styles.wordBlock}>📖 {w ? `${w.spanish} → ${w.nasaYuwe}` : String(block.wordId)}</Text>;
    }
    case "vocabulary": {
      const ids = (block.wordIds as string[]) ?? [];
      return (
        <View>
          <Text style={styles.vocabBlock}>📚 Vocabulario ({ids.length}):</Text>
          {ids.map((wid) => {
            const w = wordMap[wid];
            return <Text key={wid} style={styles.vocabItem}>{w ? `${w.spanish} → ${w.nasaYuwe}` : wid}</Text>;
          })}
        </View>
      );
    }
    case "quiz": {
      const questions = (block.questions as Array<{ prompt: string; options: Array<{ text: string; correct: boolean }>; explanation?: string }>) ?? [];
      const passScore = typeof block.passScore === "number" ? block.passScore : 70;
      return <QuizBlock questions={questions} passScore={passScore} />;
    }
    case "listening": {
      const opts = (block.options as Array<{ text: string; correct: boolean }>) ?? [];
      const mediaUrl = (block.media as { url?: string })?.url;
      return (
        <View>
          {mediaUrl ? <CachedLessonAudio lessonId={lessonId} url={String(mediaUrl)} /> : null}
          <Text style={styles.listenQ}>{String(block.question ?? "")}</Text>
          {opts.map((o, j) => (
            <Text key={j} style={styles.quizOption}>• {o.text}</Text>
          ))}
        </View>
      );
    }
    default:
      return <Text style={styles.muted}>Bloque: {block.type}</Text>;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 22, fontWeight: "bold", color: theme.primary, marginBottom: 12 },
  block: { marginBottom: 16, padding: 12, backgroundColor: theme.card, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border },
  textBlock: { fontSize: 15, lineHeight: 22 },
  imageBlock: { width: "100%", height: 200, borderRadius: theme.radius },
  caption: { fontSize: 12, color: theme.muted, marginTop: 4, textAlign: "center" },
  audioBlock: { fontSize: 15, color: theme.primary },
  audioBtn: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, alignItems: "center", borderWidth: 1, borderColor: theme.border, marginBottom: 8 },
  audioBtnText: { fontSize: 15, fontWeight: "600", color: theme.primary },
  videoBlock: { fontSize: 15, color: theme.primary },
  wordBlock: { fontSize: 15 },
  vocabBlock: { fontSize: 15 },
  vocabItem: { fontSize: 14, marginLeft: 8, color: theme.muted },
  quizTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  quizQ: { marginBottom: 12 },
  quizPrompt: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  quizOption: { fontSize: 14, marginLeft: 8, color: theme.muted },
  listenQ: { fontSize: 15, fontWeight: "600", marginBottom: 8 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 16 },
  btnDone: { backgroundColor: theme.success },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});