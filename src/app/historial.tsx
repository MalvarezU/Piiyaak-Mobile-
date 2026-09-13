import { FlatList, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../db-context";
import { theme } from "../theme";

export default function Historial() {
  const { history } = useDb();
  const router = useRouter();

  return (
    <View style={styles.root}>
      {history.length === 0 ? (
        <Text style={styles.muted}>Las fichas que abras aparecerán aquí.</Text>
      ) : (
        <FlatList
          data={history}
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
