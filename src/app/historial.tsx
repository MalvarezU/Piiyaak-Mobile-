import { FlatList, RefreshControl, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { theme } from "../theme";
import { EmptyState } from "../components/empty-state";

export default function Historial() {
  const { history, sync, store } = useDb();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sync();
    } finally {
      setRefreshing(false);
    }
  };

  const handleClear = async () => {
    if (store) await store.clearHistory();
  };

  return (
    <View style={styles.root}>
      {history.length === 0 ? (
        <EmptyState message="Las fichas que abras aparecerán aquí." icon="🕐" />
      ) : (
        <>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Text style={styles.clearText}>Limpiar historial</Text>
          </TouchableOpacity>
          <FlatList
            data={history}
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  clearBtn: { alignSelf: "flex-end", marginBottom: 8 },
  clearText: { color: theme.danger, fontSize: 14 },
  row: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.border },
  es: { fontSize: 17, fontWeight: "600" },
  ny: { fontSize: 15, color: theme.primary },
});
