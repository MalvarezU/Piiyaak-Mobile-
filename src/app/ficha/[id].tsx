import { useEffect, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Audio } from "expo-av";
import { useLocalSearchParams } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import type { WordRow } from "../../db/types";
import { audioExists, localAudioPath } from "../../audio";
import { illustrationExists, localIllustrationPath } from "../../illustrations";
import { WordIllustration } from "../../components/word-illustration";

export default function Ficha() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, favorites, toggleFavorite, pushHistory } = useDb();
  const [word, setWord] = useState<WordRow | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [illustrationSrc, setIllustrationSrc] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

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
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!word?.illustrationUrl) {
        setIllustrationSrc(null);
        return;
      }
      const exists = await illustrationExists(word.id, word.illustrationUrl);
      if (alive) {
        setIllustrationSrc(
          exists ? localIllustrationPath(word.id, word.illustrationUrl) : word.illustrationUrl
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [word]);

  // unload sound when word changes
  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setPlaying(false);
      }
    };
  }, [id]);

  if (!word) {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>Cargando ficha...</Text>
      </View>
    );
  }

  const isFav = favorites.includes(word.id);

  const togglePlay = async () => {
    if (!word.audioUrl || loading) return;
    if (soundRef.current) {
      if (playing) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        await soundRef.current.playAsync();
        setPlaying(true);
      }
      return;
    }
    setLoading(true);
    try {
      let uri = word.audioUrl;
      const exists = await audioExists(word.id, word.audioUrl);
      if (exists) uri = localAudioPath(word.id, word.audioUrl);
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setPlaying(false);
          }
        }
      );
      soundRef.current = sound;
      setPlaying(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.root}>
      <WordIllustration url={illustrationSrc} alt={word.spanish} />
      <Text style={styles.es}>{word.spanish}</Text>
      <Text style={styles.ny}>{word.nasaYuwe}</Text>
      {word.pronunciation ? <Text style={styles.pron}>[{word.pronunciation}]</Text> : null}
      {word.category ? <Text style={styles.cat}>{word.category}</Text> : null}
      {word.culturalContext ? <Text style={styles.ctx}>{word.culturalContext}</Text> : null}
      {word.examples ? <Text style={styles.examples}>Ejemplos: {word.examples}</Text> : null}
      {word.audioUrl ? (
        <TouchableOpacity
          style={styles.audioBtn}
          onPress={togglePlay}
          disabled={loading}
        >
          <Text style={styles.audioText}>
            {loading ? "..." : playing ? "⏸ Pausar" : "▶ Reproducir"}
          </Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={[styles.fav, isFav && styles.favOn]}
        onPress={() => toggleFavorite(word)}
      >
        <Text style={styles.favText}>{isFav ? "★ En favoritas" : "☆ Guardar en favoritas"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  muted: { color: theme.muted, textAlign: "center" as const, marginTop: 32 },
  pron: { color: theme.muted, marginTop: 4 },
  es: { fontSize: 30, fontWeight: "bold" as const },
  ny: { fontSize: 24, color: theme.primary, marginTop: 4 },
  cat: { marginTop: 8, color: theme.muted },
  ctx: { marginTop: 12, fontSize: 15, lineHeight: 22 },
  examples: { marginTop: 12, fontSize: 15, lineHeight: 22, fontStyle: "italic" as const },
  audioBtn: { marginTop: 16, padding: 12, borderRadius: theme.radius, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: "center" as const },
  audioText: { fontSize: 16, fontWeight: "600" as const, color: theme.primary },
  fav: { marginTop: 20, padding: 14, borderRadius: theme.radius, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: "center" as const },
  favOn: { borderColor: theme.primary },
  favText: { fontSize: 16, fontWeight: "600" as const, color: theme.primary },
});
