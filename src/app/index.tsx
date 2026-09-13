import { useEffect, useState } from "react";
import { FlatList, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { theme } from "../theme";
import type { WordRow } from "../db/types";

export default function Buscar() {
  const { store, ready } = useDb();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WordRow[]>([]);

  useEffect(() => {
    let alive = true;
    if (!store || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const r = await store.search(q.trim(), 20);
      if (alive) setResults(r);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, store]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Piiyaak</Text>
      <TextInput
        style={styles.input}
        placeholder="Buscar (mínimo 2 letras)..."
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      {!ready && <Text style={styles.muted}>Preparando diccionario offline...</Text>}
      <FlatList
        data={results}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: theme.primary, textAlign: "center", marginBottom: 12 },
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16, marginBottom: 12 },
  muted: { color: theme.muted, textAlign: "center", marginVertical: 8 },
  row: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  es: { fontSize: 18, fontWeight: "600" },
  ny: { fontSize: 16, color: theme.primary },
});
