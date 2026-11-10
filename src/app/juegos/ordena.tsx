import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import type { WordRow } from "../../db/types";
import { tokenizeOrdena, isOrdenaEligible } from "../../lib/ordena-tokenizer";

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

interface Tile {
  id: string;
  text: string;
}

export default function Ordena() {
  const { store } = useDb();
  const router = useRouter();
  const [word, setWord] = useState<WordRow | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [placed, setPlaced] = useState<Tile[]>([]);
  const [checked, setChecked] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const TOTAL = 5;

  const loadWord = async () => {
    if (!store) return;
    const all = await store.listAZ(null, 50, 0);
    const eligible = (all as WordRow[]).filter((w) => isOrdenaEligible({ spanish: w.spanish, nasaYuwe: w.nasaYuwe }));
    if (eligible.length === 0) return;
    const w = shuffle(eligible)[0];
    if (!w) return;
    const tokens = tokenizeOrdena(w.nasaYuwe);
    const tileList: Tile[] = tokens.map((t, i) => ({ id: `${w.id}-${i}`, text: t }));
    setWord(w);
    setTiles(shuffle(tileList));
    setPlaced([]);
    setChecked(false);
    setCorrect(null);
  };

  useEffect(() => {
    if (store) loadWord();
  }, [store]);

  const handleTileTap = (tile: Tile) => {
    if (checked) return;
    setTiles((prev) => prev.filter((t) => t.id !== tile.id));
    setPlaced((prev) => [...prev, tile]);
  };

  const handleUndo = (tile: Tile) => {
    if (checked) return;
    setPlaced((prev) => prev.filter((t) => t.id !== tile.id));
    setTiles((prev) => [...prev, tile]);
  };

  const handleCheck = () => {
    if (!word || placed.length === 0) return;
    const answer = placed.map((t) => t.text).join("");
    const expected = word.nasaYuwe.replace(/[\u2019\u00B4]/g, "'");
    const isOk = answer === expected;
    setChecked(true);
    setCorrect(isOk);
    if (isOk) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (round + 1 >= TOTAL) setDone(true);
    else {
      setRound((r) => r + 1);
      loadWord();
    }
  };

  if (!store) return <View style={styles.root}><Text style={styles.muted}>Preparando...</Text></View>;
  if (!word) return <View style={styles.root}><Text style={styles.muted}>Cargando...</Text></View>;

  if (done) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>¡Terminado!</Text>
        <Text style={styles.score}>Aciertos: {score} / {TOTAL}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setDone(false); setRound(0); setScore(0); loadWord(); }}>
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
      <Text style={styles.progress}>Ronda {round + 1} / {TOTAL} | Puntaje: {score}</Text>
      <Text style={styles.prompt}>Ordena las fichas para formar:</Text>
      <Text style={styles.word}>{word.spanish}</Text>
      <View style={styles.placedRow}>
        {placed.map((t) => (
          <TouchableOpacity key={t.id} style={styles.placedTile} onPress={() => handleUndo(t)}>
            <Text style={styles.tileText}>{t.text}</Text>
          </TouchableOpacity>
        ))}
        {placed.length === 0 ? <Text style={styles.placeholder}>Toca las fichas de abajo</Text> : null}
      </View>
      {checked ? (
        <Text style={[styles.result, correct ? styles.ok : styles.bad]}>
          {correct ? "✓ Correcto" : `✗ Respuesta: ${word.nasaYuwe}`}
        </Text>
      ) : null}
      <View style={styles.tilesRow}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.id} style={styles.tile} onPress={() => handleTileTap(t)}>
            <Text style={styles.tileText}>{t.text}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!checked ? (
        <TouchableOpacity style={styles.btn} onPress={handleCheck} disabled={placed.length === 0}>
          <Text style={styles.btnText}>Comprobar</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.btn} onPress={handleNext}>
          <Text style={styles.btnText}>Siguiente</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  content: { gap: 8 },
  progress: { color: theme.muted, textAlign: "center", marginBottom: 8 },
  prompt: { fontSize: 16, color: theme.muted, textAlign: "center" },
  word: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 12 },
  placedRow: { flexDirection: "row", flexWrap: "wrap", minHeight: 48, padding: 8, backgroundColor: theme.card, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, marginBottom: 8, gap: 4 },
  placedTile: { backgroundColor: theme.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  tilesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  tile: { backgroundColor: theme.card, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: theme.border },
  tileText: { fontSize: 16, fontWeight: "600", color: theme.primary },
  placeholder: { color: theme.muted, fontSize: 14 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  result: { fontSize: 16, textAlign: "center", marginTop: 8 },
  ok: { color: theme.success },
  bad: { color: theme.danger },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  score: { fontSize: 24, textAlign: "center", marginVertical: 16 },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 8 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});