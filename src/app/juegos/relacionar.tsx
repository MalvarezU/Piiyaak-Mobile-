import { useEffect, useState, useRef } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { useDb } from "../../db-context";
import { theme, fonts, spacing, minHit } from "../../theme";
import { Screen, ThemedText, Card, Button, Chip } from "../../components/ui";
import type { WordRow } from "../../db/types";
import { RefreshCw, CheckCircle2, Link2 } from "lucide-react-native";

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

interface Pair {
  id: string;
  spanish: string;
  nasaYuwe: string;
}

export default function Relacionar() {
  const { store } = useDb();
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [rightOrder, setRightOrder] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [selLeft, setSelLeft] = useState<string | null>(null);
  const [selRight, setSelRight] = useState<string | null>(null);
  const [miss, setMiss] = useState<{ left: string; right: string } | null>(null);
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const missTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    if (!store) return;
    const words = await store.listAZ(null, 6, 0);
    if (words.length < 4) return;
    const pool = shuffle(words as WordRow[]).slice(0, 6);
    const ps: Pair[] = pool.map((w) => ({
      id: w.id,
      spanish: w.spanish,
      nasaYuwe: w.nasaYuwe,
    }));
    setPairs(ps);
    setRightOrder(shuffle(ps.map((p) => p.id)));
    setMatched(new Set());
    setSelLeft(null);
    setSelRight(null);
    setMiss(null);
    setMoves(0);
    setDone(false);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      await load();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const evaluate = (leftId: string, rightId: string) => {
    setMoves((m) => m + 1);
    if (leftId === rightId) {
      setMatched((prev) => new Set(prev).add(leftId));
      setSelLeft(null);
      setSelRight(null);
      setMiss(null);
      // check done
      setMatched((prev) => {
        if (prev.size + 1 >= pairs.length) setDone(true);
        return prev;
      });
    } else {
      setMiss({ left: leftId, right: rightId });
      if (missTimer.current) clearTimeout(missTimer.current);
      missTimer.current = setTimeout(() => {
        setMiss(null);
        setSelLeft(null);
        setSelRight(null);
      }, 700);
    }
  };

  const handleLeft = (id: string) => {
    if (matched.has(id) || miss) return;
    if (selRight !== null) {
      setSelLeft(id);
      evaluate(id, selRight);
    } else {
      setSelLeft(id);
    }
  };

  const handleRight = (id: string) => {
    if (matched.has(id) || miss) return;
    if (selLeft !== null) {
      setSelRight(id);
      evaluate(selLeft, id);
    } else {
      setSelRight(id);
    }
  };

  const reset = async () => {
    await load();
  };

  if (!store || pairs.length === 0) {
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

  const pairById = new Map(pairs.map((p) => [p.id, p]));

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

        <View style={styles.columns}>
          <View style={styles.column}>
            <ThemedText variant="caption" style={styles.colHeader}>
              Español
            </ThemedText>
            {pairs.map((p) => {
              const isMatched = matched.has(p.id);
              const isSelected = selLeft === p.id;
              const isMiss = miss?.left === p.id;
              return (
                <Card
                  key={`es-${p.id}`}
                  onPress={isMatched ? undefined : () => handleLeft(p.id)}
                  style={[
                    styles.tile,
                    isMatched && styles.tileMatched,
                    isSelected && styles.tileSelected,
                    isMiss && styles.tileMiss,
                  ]}
                >
                  <ThemedText
                    variant="body"
                    style={[
                      styles.tileText,
                      cardSideStyle("es"),
                      isMatched && styles.tileTextMatched,
                    ]}
                  >
                    {p.spanish}
                  </ThemedText>
                </Card>
              );
            })}
          </View>

          <View style={styles.connectorCol}>
            <Link2 size={20} color={theme.muted} />
          </View>

          <View style={styles.column}>
            <ThemedText variant="caption" style={styles.colHeader}>
              Nasa Yuwe
            </ThemedText>
            {rightOrder.map((id) => {
              const p = pairById.get(id)!;
              const isMatched = matched.has(id);
              const isSelected = selRight === id;
              const isMiss = miss?.right === id;
              return (
                <Card
                  key={`ny-${id}`}
                  onPress={isMatched ? undefined : () => handleRight(id)}
                  style={[
                    styles.tile,
                    isMatched && styles.tileMatched,
                    isSelected && styles.tileSelected,
                    isMiss && styles.tileMiss,
                  ]}
                >
                  <ThemedText
                    variant="body"
                    style={[
                      styles.tileText,
                      cardSideStyle("ny"),
                      isMatched && styles.tileTextMatched,
                    ]}
                  >
                    {p.nasaYuwe}
                  </ThemedText>
                </Card>
              );
            })}
          </View>
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

function cardSideStyle(side: "es" | "ny") {
  return side === "ny"
    ? { fontFamily: fonts.serifSemibold, color: theme.primary }
    : { fontFamily: fonts.sansSemibold, color: theme.text };
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
  columns: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  column: {
    flex: 1,
    gap: spacing.sm,
  },
  connectorCol: {
    width: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.xl,
  },
  colHeader: {
    textAlign: "center",
    marginBottom: spacing.xs,
    color: theme.muted,
  },
  tile: {
    minHeight: minHit,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  tileMatched: {
    backgroundColor: theme.successSoft,
    borderColor: theme.success,
  },
  tileSelected: {
    borderColor: theme.primary,
    borderWidth: 2,
  },
  tileMiss: {
    borderColor: theme.danger ?? theme.muted,
  },
  tileText: {
    textAlign: "center",
  },
  tileTextMatched: {
    color: theme.success,
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
