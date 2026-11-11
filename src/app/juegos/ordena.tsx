import { useEffect, useState } from "react";
import { TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme, spacing, radiusScale, shadows } from "../../theme";
import { Screen, ThemedText, Button } from "../../components/ui";
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
    const all = await store.listRandom(50);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!store) {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText variant="body" style={styles.muted}>Preparando...</ThemedText>
        </View>
      </Screen>
    );
  }
  if (!word) {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText variant="body" style={styles.muted}>Cargando...</ThemedText>
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View style={styles.doneContainer}>
          <ThemedText variant="title" style={styles.doneTitle}>¡Terminado!</ThemedText>
          <ThemedText variant="title" style={styles.score}>Aciertos: {score} / {TOTAL}</ThemedText>
          <Button title="Reintentar" onPress={() => { setDone(false); setRound(0); setScore(0); loadWord(); }} style={styles.fullBtn} />
          <TouchableOpacity style={styles.link} onPress={() => router.back()}>
            <ThemedText variant="body" style={styles.linkText}>Volver</ThemedText>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText variant="caption" style={styles.progress}>
          Ronda {round + 1} / {TOTAL} | Puntaje: {score}
        </ThemedText>
        <ThemedText variant="body" style={styles.prompt}>
          Ordena las fichas para formar:
        </ThemedText>
        <ThemedText variant="word" style={styles.word}>
          {word.spanish}
        </ThemedText>

        <View style={styles.placedRow}>
          {placed.map((t) => (
            <TouchableOpacity key={t.id} style={styles.placedTile} onPress={() => handleUndo(t)} activeOpacity={0.85}>
              <ThemedText variant="heading" style={styles.placedTileText}>{t.text}</ThemedText>
            </TouchableOpacity>
          ))}
          {placed.length === 0 ? (
            <ThemedText variant="caption" style={styles.placeholder}>Toca las fichas de abajo</ThemedText>
          ) : null}
        </View>

        {checked ? (
          <ThemedText variant="body" style={[styles.result, correct ? styles.ok : styles.bad]}>
            {correct ? "✓ Correcto" : `✗ Respuesta: ${word.nasaYuwe}`}
          </ThemedText>
        ) : null}

        <View style={styles.tilesRow}>
          {tiles.map((t) => (
            <TouchableOpacity key={t.id} style={styles.tile} onPress={() => handleTileTap(t)} activeOpacity={0.85}>
              <ThemedText variant="heading" style={styles.tileText}>{t.text}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {!checked ? (
          <Button title="Comprobar" onPress={handleCheck} disabled={placed.length === 0} style={styles.fullBtn} />
        ) : (
          <Button title="Siguiente" onPress={handleNext} style={styles.fullBtn} />
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: { color: theme.muted },
  progress: { textAlign: "center", color: theme.muted },
  prompt: { textAlign: "center", color: theme.muted },
  word: { textAlign: "center", color: theme.primary },
  placedRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    minHeight: 64,
    padding: spacing.md,
    backgroundColor: theme.card,
    borderRadius: radiusScale.md,
    borderWidth: 1,
    borderColor: theme.border,
    gap: spacing.sm,
    boxShadow: shadows.card,
    borderCurve: "continuous",
  },
  placedTile: {
    backgroundColor: theme.primary,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.mid,
    borderWidth: 1,
    borderColor: theme.montanaDeep,
    boxShadow: shadows.card,
  },
  placedTileText: { color: theme.onTint, textAlign: "center" },
  placeholder: { color: theme.muted, textAlign: "center" },
  tilesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
  },
  tile: {
    backgroundColor: theme.card,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.mid,
    borderWidth: 1,
    borderColor: theme.border,
    boxShadow: shadows.card,
  },
  tileText: { color: theme.primary, textAlign: "center" },
  result: { textAlign: "center" },
  ok: { color: theme.success },
  bad: { color: theme.danger },
  fullBtn: { alignSelf: "stretch" },
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
