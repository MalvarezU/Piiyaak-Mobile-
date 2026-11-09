import { useEffect, useState } from "react";
import { FlatList, RefreshControl, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { useAuth } from "../auth";
import { theme } from "../theme";
import { EmptyState } from "../components/empty-state";
import type { WordRow } from "../db/types";
import { loadWordOfDay } from "../db/word-of-day";

export default function Buscar() {
  const { store, ready, sync } = useDb();
  const { session } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WordRow[]>([]);
  const [wod, setWod] = useState<WordRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  // Palabra del día (cacheada por fecha en kv; anónima desde B1)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const today = new Date().toISOString().slice(0, 10);
      try {
        const w = await loadWordOfDay(store, today, session);
        if (alive && w) setWod(w);
      } catch {
        // offline sin caché: no hay palabra del día
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, session]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sync();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Piiyaak</Text>
      {wod ? (
        <TouchableOpacity
          style={styles.wod}
          onPress={() => router.push({ pathname: "/ficha/[id]", params: { id: wod.id } })}
        >
          <Text style={styles.wodLabel}>Palabra del día</Text>
          <Text style={styles.wodEs}>{wod.spanish}</Text>
          <Text style={styles.wodNy}>{wod.nasaYuwe}</Text>
        </TouchableOpacity>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Buscar (mínimo 2 letras)..."
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
      />
      {!ready && <Text style={styles.muted}>Preparando diccionario offline...</Text>}
      <TouchableOpacity style={styles.gamesBtn} onPress={() => router.push("/juegos")}>
        <Text style={styles.gamesBtnText}>🎮 Juegos</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.gamesBtn} onPress={() => router.push("/cursos")}>
        <Text style={styles.gamesBtnText}>📚 Cursos</Text>
      </TouchableOpacity>
      {q.trim().length >= 2 && results.length === 0 ? (
        <EmptyState message="Sin resultados" icon="🔍" />
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(w) => w.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
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
  wod: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  wodLabel: { fontSize: 12, color: theme.muted, marginBottom: 4 },
  wodEs: { fontSize: 18, fontWeight: "600" },
  wodNy: { fontSize: 16, color: theme.primary },
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16, marginBottom: 12 },
  muted: { color: theme.muted, textAlign: "center", marginVertical: 8 },
  row: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  es: { fontSize: 18, fontWeight: "600" },
  ny: { fontSize: 16, color: theme.primary },
  gamesBtn: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 10, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  gamesBtnText: { fontSize: 16, fontWeight: "600", color: theme.primary },
});