import { useEffect, useState } from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { useDb } from "../../db-context";
import { theme, fonts, spacing, type, minHit } from "../../theme";
import { Screen, ThemedText, Card, Button, Chip } from "../../components/ui";
import type { WordRow } from "../../db/types";
import { RefreshCw, CheckCircle2 } from "lucide-react-native";

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

interface GameCard {
  id: string;
  text: string;
  pairId: string;
  side: "es" | "ny";
}

export default function Relacionar() {
  const { store } = useDb();
  const [cards, setCards] = useState<GameCard[]>([]);
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
      const cs: GameCard[] = [];
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

  const reset = async () => {
    if (!store) return;
    const words = await store.listAZ(null, 6, 0);
    if (words.length < 4) return;
    const pool = shuffle(words as WordRow[]).slice(0, 6);
    const cs: GameCard[] = [];
    for (const w of pool) {
      cs.push({ id: `es-${w.id}`, text: w.spanish, pairId: w.id, side: "es" });
      cs.push({ id: `ny-${w.id}`, text: w.nasaYuwe, pairId: w.id, side: "ny" });
    }
    setCards(shuffle(cs));
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setDone(false);
  };

  if (!store || cards.length === 0) {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText variant="body" style={styles.muted}>
            Preparando diccionario...
          </ThemedText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText variant="title">Relaciona</ThemedText>
          <ThemedText variant="body" style={styles.subtitle}>
            Une cada palabra en español con su pareja en Nasa Yuwe
          </ThemedText>
        </View>

        <View style={styles.statusRow}>
          <ThemedText variant="caption">Movimientos: {moves}</ThemedText>
          {done ? (
            <View style={styles.doneBadge}>
              <CheckCircle2 size={14} color={theme.success} />
              <Chip label="Completado" tone="success" />
            </View>
          ) : null}
        </View>

        <View style={styles.grid}>
          {cards.map((card, idx) => {
            const isFlipped = flipped.includes(idx) || matched.has(card.pairId);
            const isMatched = matched.has(card.pairId);
            return (
              <Card
                key={card.id}
                onPress={isFlipped ? undefined : () => handleFlip(idx)}
                style={[
                  styles.card,
                  isFlipped
                    ? isMatched
                      ? styles.cardMatched
                      : styles.cardFaceUp
                    : styles.cardFaceDown,
                ]}
              >
                {isFlipped ? (
                  <Text
                    style={[
                      styles.cardText,
                      card.side === "ny" ? styles.cardTextNasa : styles.cardTextEs,
                    ]}
                  >
                    {card.text}
                  </Text>
                ) : (
                  <Text style={styles.cardBack}>?</Text>
                )}
              </Card>
            );
          })}
        </View>

        <Button
          title="Reiniciar"
          variant="secondary"
          icon={<RefreshCw size={16} color={theme.primary} />}
          onPress={reset}
          style={styles.resetBtn}
        />
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
  header: { gap: spacing.xs },
  subtitle: { color: theme.muted },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  card: {
    width: "48%",
    aspectRatio: 1,
    minHeight: minHit,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  cardFaceDown: {
    backgroundColor: theme.successSoft,
  },
  cardFaceUp: {
    backgroundColor: theme.card,
  },
  cardMatched: {
    backgroundColor: theme.successSoft,
    borderColor: theme.success,
  },
  cardBack: {
    ...type.title,
    fontFamily: fonts.serifBold,
    color: theme.muted,
  },
  cardText: {
    textAlign: "center",
  },
  cardTextEs: {
    ...type.body,
    fontFamily: fonts.serif,
    color: theme.text,
  },
  cardTextNasa: {
    ...type.body,
    fontFamily: fonts.serifSemibold,
    color: theme.primary,
  },
  resetBtn: {
    alignSelf: "stretch",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: { color: theme.muted },
});
