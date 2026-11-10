import { useState, useEffect } from "react";
import { Text, TextInput, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import type { WordRow } from "../../db/types";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export default function Completar() {
  const { store } = useDb();
  const router = useRouter();
  const [words, setWords] = useState<WordRow[]>([]);
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const all = await store.listAZ(null, 50, 0);
      if (!alive || all.length < 4) return;
      if (alive) setWords(shuffle(all as WordRow[]).slice(0, 8));
    })();
    return () => { alive = false; };
  }, [store]);

  const word = words[current];
  if (!word) return <View style={styles.root}><Text style={styles.muted}>Cargando...</Text></View>;
  const isCorrect = normalize(input) === normalize(word.nasaYuwe);

  const handleCheck = () => {
    setChecked(true);
    if (isCorrect) setCorrect((c) => c + 1);
  };

  const handleNext = () => {
    setInput("");
    setChecked(false);
    if (current + 1 >= words.length) setDone(true);
    else setCurrent((c) => c + 1);
  };

  if (!store) return <View style={styles.root}><Text style={styles.muted}>Preparando...</Text></View>;
  if (words.length === 0) return <View style={styles.root}><Text style={styles.muted}>Cargando...</Text></View>;

  if (done) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>¡Terminado!</Text>
        <Text style={styles.score}>Aciertos: {correct} / {words.length}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setDone(false); setCurrent(0); setCorrect(0); setInput(""); setChecked(false); }}>
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
      <Text style={styles.progress}>{current + 1} / {words.length}</Text>
      <Text style={styles.prompt}>Escribe la traducción en Nasa Yuwe:</Text>
      <Text style={styles.word}>{word.spanish}</Text>
      <TextInput
        style={styles.input}
        placeholder="Nasa Yuwe..."
        value={input}
        onChangeText={setInput}
        autoCapitalize="none"
        editable={!checked}
      />
      {!checked ? (
        <TouchableOpacity style={styles.btn} onPress={handleCheck}>
          <Text style={styles.btnText}>Comprobar</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={[styles.result, isCorrect ? styles.ok : styles.bad]}>
            {isCorrect ? "✓ Correcto" : `✗ La respuesta era: ${word.nasaYuwe}`}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={handleNext}>
            <Text style={styles.btnText}>Siguiente</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 8 },
  content: { gap: 8 },
  progress: { color: theme.muted, textAlign: "center", marginBottom: 8 },
  prompt: { fontSize: 16, color: theme.muted, textAlign: "center" },
  word: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 12 },
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  result: { fontSize: 16, textAlign: "center", marginTop: 8 },
  ok: { color: theme.success },
  bad: { color: theme.danger },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  score: { fontSize: 24, textAlign: "center", marginVertical: 16 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});