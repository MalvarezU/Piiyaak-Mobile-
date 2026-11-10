import { useEffect, useRef, useState } from "react";
import { ScrollView, View, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { BookOpen, Volume2, Heart } from "lucide-react-native";
import { useDb } from "../../db-context";
import { theme, fonts, spacing } from "../../theme";
import type { WordRow } from "../../db/types";
import { createAudioPlayer, type AudioPlayer } from "../../audio-player";
import { resolveAudioUri } from "../../audio";
import { resolveIllustrationUri } from "../../illustrations";
import { WordIllustration } from "../../components/word-illustration";
import { Screen, ThemedText, Card, Button, Chip } from "../../components/ui";

export default function Ficha() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, favorites, toggleFavorite, pushHistory } = useDb();
  const [word, setWord] = useState<WordRow | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [illustrationSrc, setIllustrationSrc] = useState<string | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedRef = useRef(false);

  const getPlayer = (): AudioPlayer => {
    if (!playerRef.current) playerRef.current = createAudioPlayer();
    return playerRef.current;
  };

  const unloadPlayer = () => {
    loadedRef.current = false;
    setPlaying(false);
    const player = playerRef.current;
    if (player) player.unload().catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store || !id) return;
      const w = await store.getById(String(id));
      if (alive && w) {
        setWord(w);
        pushHistory(w);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, id]);

  useEffect(() => {
    return () => {
      unloadPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!word?.illustrationUrl) {
        setIllustrationSrc(null);
        return;
      }
      // Doble lookup por contenido (B3-03): cache → heredado → remoto.
      const uri = await resolveIllustrationUri({
        id: word.id,
        illustrationUrl: word.illustrationUrl,
        illustrationSha256: word.illustrationSha256 ?? null,
      });
      if (alive) {
        setIllustrationSrc(uri);
      }
    })();
    return () => {
      alive = false;
    };
  }, [word]);

  // unload sound when word changes
  useEffect(() => {
    return () => {
      unloadPlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!word) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ThemedText variant="body" style={styles.muted}>
            Cargando ficha...
          </ThemedText>
        </View>
      </Screen>
    );
  }

  const isFav = favorites.includes(word.id);

  const togglePlay = async () => {
    if (!word.audioUrl || loading) return;
    const player = getPlayer();
    if (loadedRef.current) {
      if (playing) {
        await player.pause();
        setPlaying(false);
      } else {
        await player.seekTo(0);
        await player.play();
        setPlaying(true);
      }
      return;
    }
    setLoading(true);
    try {
      const uri = await resolveAudioUri({
        id: word.id,
        audioUrl: word.audioUrl,
        audioSha256: word.audioSha256 ?? null,
      });
      await player.load(uri, () => setPlaying(false));
      loadedRef.current = true;
      await player.play();
      setPlaying(true);
    } catch {
      // offline sin caché: no hay audio
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <WordIllustration url={illustrationSrc} alt={word.spanish} />
        <ThemedText variant="word" style={styles.spanishTitle}>
          {word.spanish}
        </ThemedText>
        <View style={styles.nyRow}>
          <BookOpen size={20} color={theme.primary} />
          <ThemedText variant="caption" style={styles.nyLabel}>
            Nasa Yuwe:
          </ThemedText>
          {word.nasaYuwe ? (
            <ThemedText variant="body" style={styles.nyWord}>
              {word.nasaYuwe}
            </ThemedText>
          ) : (
            <ThemedText variant="body" style={styles.muted}>
              Traducción no disponible aún
            </ThemedText>
          )}
        </View>
        {word.pronunciation ? (
          <Card>
            <View style={styles.pronHeader}>
              <Volume2 size={20} color={theme.primary} />
              <ThemedText variant="caption" style={styles.pronCaption}>
                Pronunciación fonética
              </ThemedText>
            </View>
            <ThemedText variant="heading" style={styles.pronText}>
              [{word.pronunciation}]
            </ThemedText>
          </Card>
        ) : (
          <Card style={styles.mutedCard}>
            <ThemedText variant="body" style={styles.muted}>
              Pronunciación no disponible
            </ThemedText>
          </Card>
        )}
        {word.audioUrl ? (
          <Button
            title={loading ? "..." : playing ? "Pausar" : "Reproducir"}
            onPress={togglePlay}
            variant="primary"
            disabled={loading}
            icon={<Volume2 size={20} color={theme.onTint} />}
            style={styles.fullWidth}
          />
        ) : null}
        {word.category ? (
          <Chip label={word.category} tone="accent" />
        ) : (
          <ThemedText variant="caption" style={styles.muted}>
            Categoría desconocida
          </ThemedText>
        )}
        {word.culturalContext ? (
          <Card>
            <ThemedText variant="body">{word.culturalContext}</ThemedText>
          </Card>
        ) : null}
        {word.examples ? (
          <ThemedText variant="body" style={styles.examples}>
            Ejemplos: {word.examples}
          </ThemedText>
        ) : null}
        <Button
          title={isFav ? "En favoritas" : "Guardar en favoritas"}
          onPress={() => toggleFavorite(word)}
          variant="secondary"
          icon={
            <Heart
              size={20}
              color={theme.primary}
              fill={isFav ? theme.primary : "transparent"}
            />
          }
          style={styles.fullWidth}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  muted: { color: theme.muted },
  spanishTitle: {
    color: theme.primary,
  },
  nyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  nyLabel: {
    color: theme.muted,
  },
  nyWord: {
    fontFamily: fonts.serifSemibold,
    color: theme.primary,
  },
  pronHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  pronCaption: {
    color: theme.muted,
  },
  pronText: {
    color: theme.primary,
  },
  mutedCard: {
    backgroundColor: theme.background,
  },
  fullWidth: {
    width: "100%",
  },
  examples: {
    fontStyle: "italic",
  },
});