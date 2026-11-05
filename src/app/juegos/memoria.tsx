import { useEffect, useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
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

interface Card {
  id: string;
  text: string;
  pairId: string;
  side: "es" | "ny";
}

export default function Memoria() {
  const { store } = useDb();
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const words = await store.listAZ(null, 6, 0);
      if (!alive || words.length < 4) return;
      const pool = shuffle(words as WordRow[]).slice(0, 6);
      const cs: Card[] = [];
      for (const w of pool) {
        cs.push({ id: `es-${w.id}`, text: w.spanish, pairId: w.id, side: "es" });
        cs.push({ id: `ny-${w.id}`, text: w.nasaYuwe, pairId: w.id, side: "ny" });
      }
      if (alive) setCards(shuffle(cs));
    })();
    return () => { alive = false; };
  }, [store]);

  const handleFlip = (idx: number) => {
    if (flipped.length >= 2) return;
    if (flipped.includes(idx)) return;
    const card = cards[idx];
    if (!card || matched.has(card.pairId)) return;
    const next = [...flipped, idx];
    setFlipped(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      const a = cards[next[0]!];
      const b = cards[next[1]!];
      if (a && b && a.pairId === b.pairId && a.side !== b.side) {
        setMatched((prev) => new Set(prev).add(a.pairId));
        setFlipped([]);
        if (matched.size + 1 >= cards.length / 2) setDone(true);
      } else {
        setTimeout(() => setFlipped([]), 800);
      }
    }
  };

  if (!store) return <View style={styles.root}><Text style={styles.muted}>Preparando...</Text></View>;
  if (cards.length === 0) return <View style={styles.root}><Text style={styles.muted}>Cargando...</Text></View>;

  if (done) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>¡Completado!</Text>
        <Text style={styles.score}>Movimientos: {moves}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { setDone(false); setMatched(new Set()); setFlipped([]); setMoves(0); }}>
          <Text style={styles.btnText}>Reintentar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => router.back()}>
          <Text style={styles.linkText}>Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.info}>Movimientos: {moves} | Parejas: {matched.size}/{cards.length / 2}</Text>
      <View style={styles.grid}>
        {cards.map((card, idx) => {
          const isFlipped = flipped.includes(idx) || matched.has(card.pairId);
          return (
            <TouchableOpacity
              key={card.id}
              style={[styles.card, isFlipped ? styles.cardFlipped : styles.cardHidden]}
              onPress={() => handleFlip(idx)}
              disabled={isFlipped}
            >
              {isFlipped ? (
                <Text style={styles.cardText}>{card.text}</Text>
              ) : (
                <Text style={styles.cardBack}>?</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  info: { textAlign: "center", color: theme.muted, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  card: { width: "30%", aspectRatio: 1, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", padding: 4 },
  cardHidden: { backgroundColor: theme.primary },
  cardFlipped: { backgroundColor: theme.card },
  cardText: { fontSize: 12, textAlign: "center" },
  cardBack: { fontSize: 24, color: "#fff", fontWeight: "bold" },
  title: { fontSize: 24, fontWeight: "bold", textAlign: "center", color: theme.primary, marginBottom: 8 },
  score: { fontSize: 20, textAlign: "center", marginVertical: 12 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});