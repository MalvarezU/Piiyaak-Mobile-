import { useEffect, useState, useRef } from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { Volume2 } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme, spacing, minHit } from "../../theme";
import { Screen, ThemedText, Card, Button } from "../../components/ui";
import type { WordRow } from "../../db/types";
import { createAudioPlayer } from "../../audio-player";
import { resolveAudioUri } from "../../audio";

const MIN = 4;
const MAX_ROUNDS = 8;

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

export default function Escucha() {
  const { store } = useDb();
  const router = useRouter();
  const player = useRef(createAudioPlayer());
  const [rounds, setRounds] = useState<WordRow[]>([]);
  /** Pool completo con audio: fuente de distractores con variedad real. */
  const [pool, setPool] = useState<WordRow[]>([]);
  /** Incrementa al reintentar: re-baraja rondas (antes repetía las mismas 8). */
  const [gameKey, setGameKey] = useState(0);
  const [roundIndex, setRoundIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

    useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      // Pool directo por audioUrl (query dedicada): nunca depende del
      // corte alfabético del listAZ, que dejaba el juego sin rondas
      // cuando las palabras con audio ordenaban tarde.
      const all = await store.listWithAudio(200);
      if (!alive) return;
      const shuffled = shuffle(all as WordRow[]);
      const chosen = shuffled.slice(0, MAX_ROUNDS);
      if (alive) {
        setPool(all as WordRow[]);
        setRounds(chosen);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, gameKey]);

  useEffect(() => {
    const p = player.current;
    return () => {
      void p.unload();
    };
  }, []);

  useEffect(() => {
    if (rounds.length === 0) return;
    const word = rounds[roundIndex];
    if (!word) return;
    // Distractores del pool COMPLETO con audio (no solo de las 8 rondas
    // de la sesión): más variedad y opciones menos predecibles.
    const source = pool.length >= 4 ? pool : rounds;
    const others = source.filter((w) => w.id !== word.id);
    const distractors = shuffle(others).slice(0, 3).map((w) => w.spanish);
    const opts = shuffle([word.spanish, ...distractors]);
    setOptions(opts);
    setSelected(null);
    setFeedback(null);
    setPlaying(false);
    void player.current.unload();
  }, [rounds, roundIndex, pool]);

  const currentWord = rounds[roundIndex] as WordRow;

  const handlePlay = async () => {
    if (!currentWord?.audioUrl || playing) return;
    setPlaying(true);
    try {
      // cache (media-cache) → heredado → bundled → remota: las palabras
      // embebidas suenan offline y las no embebidas vía red/caché.
      const uri = await resolveAudioUri({
        id: currentWord.id,
        audioUrl: currentWord.audioUrl,
      });
      await player.current.load(uri, () => setPlaying(false));
      await player.current.play();
    } catch {
      setPlaying(false);
    }
  };

  const handleSelect = (opt: string) => {
    if (selected !== null || !currentWord) return;
    const correct = opt === currentWord.spanish;
    setSelected(opt);
    setFeedback(correct ? "correct" : "wrong");
    if (correct) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (roundIndex + 1 >= rounds.length) setDone(true);
    else setRoundIndex((i) => i + 1);
  };

  const handleRetry = () => {
    setDone(false);
    setScore(0);
    setRoundIndex(0);
    // Pausa el estado listo y re-baraja: "Reintentar" ya no repite las
    // mismas rondas (el efecto re-dibuja con gameKey nuevo).
    setReady(false);
    setGameKey((k) => k + 1);
  };

  if (!store || !ready) {
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

  if (rounds.length < MIN) {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText variant="title" style={styles.cardTitle}>
            Requiere audios
          </ThemedText>
          <ThemedText variant="caption" style={styles.cardNote}>
            Necesita al menos {MIN} palabras con audio publicado.
          </ThemedText>
          <Button
            title="Volver"
            variant="secondary"
            onPress={() => router.back()}
            style={styles.backBtn}
          />
        </View>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen>
        <View style={styles.center}>
          <ThemedText variant="title">¡Terminado!</ThemedText>
          <ThemedText variant="heading" style={styles.score}>
            {score} / {rounds.length} aciertos
          </ThemedText>
          <Button
            title="Reintentar"
            variant="primary"
            onPress={handleRetry}
            style={styles.backBtn}
          />
          <Button
            title="Volver"
            variant="secondary"
            onPress={() => router.back()}
            style={styles.backBtn}
          />
        </View>
      </Screen>
    );
  }

  const correctSpanish = currentWord.spanish;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText variant="title">Escucha</ThemedText>
          <ThemedText variant="caption" style={styles.subtitle}>
            Escucha el audio en Nasa Yuwe y elige su significado en español.
          </ThemedText>
        </View>

        <View style={styles.statusRow}>
          <ThemedText variant="caption">
            Ronda {roundIndex + 1} / {rounds.length}
          </ThemedText>
          <ThemedText variant="caption">Aciertos: {score}</ThemedText>
        </View>

        <Button
          title={playing ? "Reproduciendo..." : "Reproducir audio"}
          variant="primary"
          icon={<Volume2 size={20} color={theme.onTint} />}
          disabled={playing}
          onPress={handlePlay}
          style={styles.audioBtn}
        />

        <View style={styles.options}>
          {options.map((opt, idx) => {
            const isCorrect = opt === correctSpanish;
            const isSelected = opt === selected;
            let bg: string = theme.card;
            let borderColor: string = theme.border;
            if (selected !== null) {
              if (isCorrect) {
                bg = theme.successSoft;
                borderColor = theme.success;
              } else if (isSelected) {
                bg = theme.dangerSoft;
                borderColor = theme.danger;
              }
            }
            return (
              <Button
                key={`${opt}-${idx}`}
                title={opt}
                variant="secondary"
                disabled={selected !== null}
                onPress={() => handleSelect(opt)}
                style={[
                  styles.optionBtn,
                  { backgroundColor: bg, borderColor },
                  selected !== null ? { opacity: 1 } : null,
                ]}
              />
            );
          })}
        </View>

        {feedback ? (
          <>
            <ThemedText
              variant="bodyStrong"
              style={[
                styles.feedback,
                { color: feedback === "correct" ? theme.success : theme.danger },
              ]}
            >
              {feedback === "correct" ? "✓ Correcto" : "✗ Incorrecto"}
            </ThemedText>
            {/* Revelado pedagógico: la palabra escuchada, cómo se escribe
                y su pronunciación (antes solo coloreaba la opción). */}
            <Card style={styles.reveal}>
              <ThemedText variant="caption">
                La palabra en Nasa Yuwe:
              </ThemedText>
              <ThemedText variant="heading" style={styles.revealWord}>
                {currentWord.nasaYuwe}
              </ThemedText>
              {currentWord.pronunciation ? (
                <ThemedText variant="caption" style={styles.revealPron}>
                  [{currentWord.pronunciation}]
                </ThemedText>
              ) : null}
              <Button
                title="Escuchar de nuevo"
                variant="ghost"
                icon={<Volume2 size={16} color={theme.primary} />}
                onPress={handlePlay}
                style={styles.revealBtn}
              />
            </Card>
          </>
        ) : null}

        {selected !== null ? (
          <Button
            title="Siguiente"
            variant="primary"
            onPress={handleNext}
            style={styles.nextBtn}
          />
        ) : null}
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
  audioBtn: {
    alignSelf: "stretch",
    minHeight: 56,
  },
  options: {
    gap: spacing.sm,
  },
  optionBtn: {
    alignSelf: "stretch",
    minHeight: minHit,
  },
  feedback: {
    textAlign: "center",
  },
  reveal: {
    gap: spacing.xs,
    alignItems: "center",
  },
  revealWord: { textAlign: "center" },
  revealPron: { textAlign: "center", color: theme.muted },
  revealBtn: { marginTop: spacing.xs },
  nextBtn: {
    alignSelf: "stretch",
  },
  backBtn: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  cardTitle: { textAlign: "center" },
  cardNote: { textAlign: "center", color: theme.muted },
  score: { textAlign: "center", color: theme.montana },
  muted: { color: theme.muted, textAlign: "center" },
});
