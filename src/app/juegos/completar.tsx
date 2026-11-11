import { useState, useEffect } from "react";
import { TextInput, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme, spacing, radiusScale, fonts, type, minHit } from "../../theme";
import { Screen, ThemedText, Button } from "../../components/ui";
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

/**
 * Construye la pista: la palabra en Nasa Yuwe con ~35% de sus letras
 * reemplazadas por "_" (mismo ancho visual). Posiciones deterministas
 * a partir del id de la palabra para que la pista sea estable.
 */
function makeHint(word: string, seed: string): string {
  const chars = Array.from(word);
  const len = chars.length;
  if (len === 0) return "";
  const eligible: number[] = [];
  for (let i = 0; i < len; i++) {
    const ch = chars[i] as string;
    if (ch.trim() !== "") eligible.push(i);
  }
  const pool = eligible.length > 0 ? eligible : chars.map((_, i) => i);
  const hide = Math.max(1, Math.min(pool.length - 1, Math.round(pool.length * 0.35)));
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const positions = new Set<number>();
  let guard = 0;
  while (positions.size < hide && guard < pool.length * 10 + 5) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const idx = pool[h % pool.length] as number;
    positions.add(idx);
    guard++;
  }
  return chars.map((c, i) => (positions.has(i) ? "_" : c)).join("");
}

export default function Completar() {
  const { store } = useDb();
  const router = useRouter();
  const [words, setWords] = useState<WordRow[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const all = await store.listRandom(50);
      if (!alive || all.length < 4) return;
      if (alive) {
        const picked = shuffle(all as WordRow[]).slice(0, 8);
        setWords(picked);
        setHints(picked.map((w) => makeHint(w.nasaYuwe, w.id)));
      }
    })();
    return () => { alive = false; };
  }, [store]);

  const word = words[current];
  if (!word) return <Screen><View style={styles.center}><ThemedText variant="body" style={styles.muted}>Cargando...</ThemedText></View></Screen>;
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

  if (!store) return <Screen><View style={styles.center}><ThemedText variant="body" style={styles.muted}>Preparando...</ThemedText></View></Screen>;
  if (words.length === 0) return <Screen><View style={styles.center}><ThemedText variant="body" style={styles.muted}>Cargando...</ThemedText></View></Screen>;

  if (done) {
    return (
      <Screen>
        <View style={styles.doneContainer}>
          <ThemedText variant="title" style={styles.doneTitle}>¡Terminado!</ThemedText>
          <ThemedText variant="title" style={styles.score}>Aciertos: {correct} / {words.length}</ThemedText>
          <Button title="Reintentar" onPress={() => { setDone(false); setCurrent(0); setCorrect(0); setInput(""); setChecked(false); }} style={styles.fullBtn} />
          <TouchableOpacity style={styles.link} onPress={() => router.back()}>
            <ThemedText variant="body" style={styles.linkText}>Volver</ThemedText>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  const hint = hints[current] ?? makeHint(word.nasaYuwe, word.id);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText variant="caption" style={styles.progress}>
          {current + 1} / {words.length}
        </ThemedText>
        <ThemedText variant="body" style={styles.prompt}>
          Completa la traducción en Nasa Yuwe:
        </ThemedText>
        <ThemedText variant="word" style={styles.word}>
          {word.spanish}
        </ThemedText>
        <ThemedText variant="word" style={styles.hint}>
          {hint}
        </ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Escribe la palabra completa..."
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          editable={!checked}
        />
        {!checked ? (
          <Button title="Comprobar" onPress={handleCheck} style={styles.fullBtn} />
        ) : (
          <>
            <ThemedText variant="body" style={[styles.result, isCorrect ? styles.ok : styles.bad]}>
              {isCorrect ? "✓ Correcto" : `✗ La respuesta era: ${word.nasaYuwe}`}
            </ThemedText>
            <Button title="Siguiente" onPress={handleNext} style={styles.fullBtn} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: { color: theme.muted },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  progress: { textAlign: "center", color: theme.muted },
  prompt: { textAlign: "center", color: theme.muted },
  word: { textAlign: "center", color: theme.primary },
  hint: {
    textAlign: "center",
    color: theme.text,
    letterSpacing: 4,
    fontFamily: fonts.serif,
  },
  input: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radiusScale.md,
    borderCurve: "continuous",
    padding: spacing.md,
    fontSize: type.body.fontSize,
    fontFamily: type.body.fontFamily,
    color: theme.text,
  },
  result: { textAlign: "center" },
  ok: { color: theme.success },
  bad: { color: theme.danger },
  fullBtn: { alignSelf: "stretch", minHeight: minHit },
  doneContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  doneTitle: { textAlign: "center", color: theme.primary },
  score: { textAlign: "center", color: theme.text },
  link: { padding: spacing.md, alignItems: "center" },
  linkText: { color: theme.primary },
});
