import { useEffect, useState } from "react";
import { FlatList, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { theme } from "../theme";
import type { WordRow } from "../db/types";

function useFavWords(ids: string[]): WordRow[] {
  const { store } = useDb();
  const [words, setWords] = useState<WordRow[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const rows: WordRow[] = [];
      for (const id of ids) {
        const w = await store.getById(id);
        if (w) rows.push(w);
      }
      if (alive) setWords(rows);
    })();
    return () => {
      alive = false;
    };
  }, [store, ids.join(",")]);
  return words;
}

export default function Favoritos() {
  const { favorites, toggleFavorite } = useDb();
  const router = useRouter();
  const words = useFavWords(favorites);

  return (
    <View style={styles.root}>
      {words.length === 0 ? (
        <Text style={styles.muted}>
          Sin favoritas. Marca palabras desde su ficha para verlas aquí sin conexión.
        </Text>
      ) : (
        <FlatList
          data={words}
          keyExtractor={(w) => w.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push({ pathname: "/ficha/[id]", params: { id: item.id } })}
              onLongPress={() => toggleFavorite(item)}
            >
              <Text style={styles.es}>{item.spanish}</Text>
              <Text style={styles.ny}>{item.nasaYuwe}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  muted: { color: theme.muted, textAlign: "center" as const, marginTop: 32 },
  row: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  es: { fontSize: 17, fontWeight: "600" },
  ny: { fontSize: 15, color: theme.primary },
});
