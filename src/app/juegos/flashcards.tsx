import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import { pickGameWords } from "../../lib/game-words";
import { buildRound } from "../../lib/game-questions";
import { stringSimilarity } from "../../lib/string-similarity";

interface Question {
  prompt: string;
  title: string;
  options: string[];
  correctIndex: number;
}

export default function Flashcards() {
  const { store } = useDb();
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [direction, setDirection] = useState<"es-nasa" | "nasa-es">("es-nasa");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      // Pool con rotación (buffer `games:recent` compartido entre juegos):
      // pickGameWords registra lo devuelto, la pantalla no toca el buffer.
      const pool = await pickGameWords(store, { count: 8 });
      if (!alive || pool.length < 4) return;
      // Opciones únicas y sin fuga: los distractores salen del pool no
      // preguntado, con similaridad para forzar discriminación fina.
      const built = buildRound({
        pool,
        askCount: 8,
        distractorCount: 3,
        answerOf: direction === "es-nasa" ? (w) => w.nasaYuwe : (w) => w.spanish,
        similarityOf: (a, b) => stringSimilarity(a.nasaYuwe, b.nasaYuwe),
      });
      const qs: Question[] = built.map((q) => ({
        prompt:
          direction === "es-nasa"
            ? "¿Cómo se dice en Nasa Yuwe?"
            : "¿Qué significa en español?",
        title: direction === "es-nasa" ? q.word.spanish : q.word.nasaYuwe,
        options: q.options,
        correctIndex: q.correctIndex,
      }));
      if (alive) setQuestions(qs);
    })();
    return () => { alive = false; };
  }, [store, direction]);

  if (!store) return <View style={styles.root}><Text style={styles.muted}>Preparando...</Text></View>;
  if (questions.length === 0) return <View style={styles.root}><Text style={styles.muted}>Cargando preguntas...</Text></View>;

  const q = questions[current];
  if (!q) return <View style={styles.root}><Text style={styles.muted}>Cargando...</Text></View>;

  const handleSelect = (idx: number) => {
    if (selected !== null) return;
    setSelected(idx);
    if (idx === q.correctIndex) setScore((s) => s + 1);
  };

  const handleNext = () => {
    setSelected(null);
    if (current + 1 >= questions.length) setDone(true);
    else setCurrent((c) => c + 1);
  };

  if (done) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>¡Terminado!</Text>
        <Text style={styles.score}>Puntaje: {score} / {questions.length}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setDone(false); setCurrent(0); setScore(0); setSelected(null); }}>
          <Text style={styles.btnText}>Reintentar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => router.back()}>
          <Text style={styles.linkText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.progress}>{current + 1} / {questions.length}</Text>
      <Text style={styles.prompt}>{q.prompt}</Text>
      <Text style={styles.titleWord}>{q.title}</Text>
      {q.options.map((opt, idx) => {
        const isCorrect = idx === q.correctIndex;
        const isSelected = idx === selected;
        let bg = theme.card as string;
        if (selected !== null) {
          if (isCorrect) bg = theme.successSoft;
          else if (isSelected) bg = theme.dangerSoft;
        }
        return (
          <TouchableOpacity
            key={idx}
            style={[styles.option, { backgroundColor: bg }]}
            onPress={() => handleSelect(idx)}
            disabled={selected !== null}
          >
            <Text style={styles.optionText}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
      {selected !== null ? (
        <TouchableOpacity style={styles.btn} onPress={handleNext}>
          <Text style={styles.btnText}>Siguiente</Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 8 },
  content: { gap: 8 },
  progress: { color: theme.muted, textAlign: "center", marginBottom: 8 },
  prompt: { fontSize: 16, color: theme.muted, textAlign: "center" },
  titleWord: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 12 },
  option: { padding: 14, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, marginBottom: 8 },
  optionText: { fontSize: 16 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  score: { fontSize: 24, textAlign: "center", marginVertical: 16 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});