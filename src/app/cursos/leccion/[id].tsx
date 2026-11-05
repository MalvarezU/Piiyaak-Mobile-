import { useEffect, useState } from "react";
import { Audio } from "expo-av";
import { QuizBlock } from "../../../components/quiz-block";
import { ScrollView, Text, TouchableOpacity, View, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDb } from "../../../db-context";
import { useAuth } from "../../../auth";
import { SQLiteCourseStore } from "../../../db/course-store";
import { openDatabaseSync } from "expo-sqlite";
import { apiFetch } from "../../../api";
import { theme } from "../../../theme";
import type { LessonRow } from "../../../db/course-types";
import type { CourseProgressRow } from "../../../db/course-types";

interface Block {
  id: string;
  type: string;
  [key: string]: unknown;
}

export default function Leccion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [lesson, setLesson] = useState<LessonRow | null>(null);
  const [courseStore, setCourseStore] = useState<SQLiteCourseStore | null>(null);
  const [completed, setCompleted] = useState(false);
  const [progressStore, setProgressStore] = useState<SQLiteCourseStore | null>(null);
  const [wordMap, setWordMap] = useState<Record<string, { spanish: string; nasaYuwe: string }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store || !id) return;
      const db = openDatabaseSync("piiyaak.db");
      const cs = await SQLiteCourseStore.open(db);
      if (!alive) return;
      setCourseStore(cs);
      setProgressStore(cs);
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
  }, [store, id]);

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
          {renderBlock(block, wordMap)}
        </View>
      ))}
      <TouchableOpacity
        style={[styles.btn, completed ? styles.btnDone : null]}
        onPress={async () => {
          if (!progressStore || !id) return;
          const next = !completed;
          setCompleted(next);
          await progressStore.setProgress(String(id), next, next ? 100 : null);
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

function renderBlock(block: Block, wordMap: Record<string, { spanish: string; nasaYuwe: string }>) {
  switch (block.type) {
    case "text":
      return <Text style={styles.textBlock}>{String(block.html ?? "").replace(/<[^>]*>/g, "")}</Text>;
    case "image":
      return (
        <View>
          {block.url ? <Image source={{ uri: String(block.url) }} style={styles.imageBlock} resizeMode="cover" /> : null}
          {block.caption ? <Text style={styles.caption}>{String(block.caption)}</Text> : null}
        </View>
      );
    case "audio":
      return <Text style={styles.audioBlock}>🔊 Audio: {String((block.media as { url?: string })?.url ?? "")}</Text>;
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
      return (
        <View>
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
  btnDone: { backgroundColor: "#16a34a" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});