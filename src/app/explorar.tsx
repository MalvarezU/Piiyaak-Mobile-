import { useEffect, useState } from "react";
import { FlatList, ScrollView, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { theme } from "../theme";
import type { WordRow } from "../db/types";

export default function Explorar() {
  const { store } = useDb();
  const router = useRouter();
  const [words, setWords] = useState<WordRow[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const PAGE = 50;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const cats = await store.listCategories();
      if (alive) setCategories(cats);
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const [rows, n] = await Promise.all([
        store.listAZ(category, PAGE, page * PAGE),
        store.count(),
      ]);
      if (!alive) return;
      setWords((prev) => (page === 0 ? rows : [...prev, ...rows]));
      setTotal(n);
    })();
    return () => {
      alive = false;
    };
  }, [store, page, category]);

  // reset page on category change
  useEffect(() => {
    setPage(0);
    setWords([]);
  }, [category]);

  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catBar}>
        <TouchableOpacity
          style={[styles.chip, category === null && styles.chipOn]}
          onPress={() => setCategory(null)}
        >
          <Text style={[styles.chipText, category === null && styles.chipTextOn]}>Todas</Text>
        </TouchableOpacity>
        {categories.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, category === c && styles.chipOn]}
            onPress={() => setCategory(c)}
          >
            <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.count}>
        {words.length} de {total} palabras
      </Text>
      <FlatList
        data={words}
        keyExtractor={(w) => w.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push({ pathname: "/ficha/[id]", params: { id: item.id } })}
          >
            <Text style={styles.es}>{item.spanish}</Text>
            <Text style={styles.ny}>{item.nasaYuwe}</Text>
          </TouchableOpacity>
        )}
        onEndReached={() => {
          if (words.length < total) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  catBar: { flexGrow: 0, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, marginRight: 8 },
  chipOn: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipText: { fontSize: 13, color: theme.muted },
  chipTextOn: { color: "#fff", fontWeight: "600" as const },
  count: { color: theme.muted, marginBottom: 8 },
  row: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  es: { fontSize: 17, fontWeight: "600" },
  ny: { fontSize: 15, color: theme.primary },
});