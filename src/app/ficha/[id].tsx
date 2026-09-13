import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";
import type { WordRow } from "../../db/types";

export default function Ficha() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, favorites, toggleFavorite, pushHistory } = useDb();
  const [word, setWord] = useState<WordRow | null>(null);

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

  if (!word) {
    return (
      <View style={styles.root}>
        <Text style={styles.muted}>Cargando ficha...</Text>
      </View>
    );
  }

  const isFav = favorites.includes(word.id);

  return (
    <ScrollView style={styles.root}>
      <Text style={styles.es}>{word.spanish}</Text>
      <Text style={styles.ny}>{word.nasaYuwe}</Text>
      {word.pronunciation ? <Text style={styles.pron}>[{word.pronunciation}]</Text> : null}
      {word.category ? <Text style={styles.cat}>{word.category}</Text> : null}
      {word.culturalContext ? <Text style={styles.ctx}>{word.culturalContext}</Text> : null}
      <TouchableOpacity
        style={[styles.fav, isFav && styles.favOn]}
        onPress={() => toggleFavorite(word)}
      >
        <Text style={styles.favText}>{isFav ? "★ En favoritas" : "☆ Guardar en favoritas"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const stylesmuted = { color: "#78716c", marginTop: 4 };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  muted: { color: theme.muted, textAlign: "center" as const, marginTop: 32 },
  pron: { color: theme.muted, marginTop: 4 },
  es: { fontSize: 30, fontWeight: "bold" as const },
  ny: { fontSize: 24, color: theme.primary, marginTop: 4 },
  cat: { marginTop: 8, color: theme.muted },
  ctx: { marginTop: 12, fontSize: 15, lineHeight: 22 },
  fav: { marginTop: 20, padding: 14, borderRadius: theme.radius, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, alignItems: "center" as const },
  favOn: { borderColor: theme.primary },
  favText: { fontSize: 16, fontWeight: "600" as const, color: theme.primary },
});
