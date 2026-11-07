import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme } from "../../theme";

export default function JuegosHub() {
  const { store } = useDb();
  const router = useRouter();

  const games = [
    { id: "flashcards", title: "Flashcards", desc: "Opción múltiple ES ↔ Nasa Yuwe", emoji: "🃏" },
    { id: "memoria", title: "Memoria", desc: "Empareja español y Nasa Yuwe", emoji: "🧠" },
    { id: "completar", title: "Completar", desc: "Completa la traducción", emoji: "✏️" },
    { id: "ordena", title: "Ordena", desc: "Ordena las fichas de la palabra", emoji: "🔤" },
  ];

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Juegos</Text>
      <Text style={styles.subtitle}>Practica con el diccionario (100% offline)</Text>
      {games.map((g) => (
        <TouchableOpacity
          key={g.id}
          style={styles.card}
          onPress={() => router.push(`/juegos/${g.id}` as any)}
          disabled={!store}
        >
          <Text style={styles.emoji}>{g.emoji}</Text>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>{g.title}</Text>
            <Text style={styles.cardDesc}>{g.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}
      {!store ? <Text style={styles.muted}>Preparando diccionario...</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: theme.primary, textAlign: "center", marginBottom: 4 },
  subtitle: { color: theme.muted, textAlign: "center", marginBottom: 16 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: theme.card, borderRadius: theme.radius, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  emoji: { fontSize: 32, marginRight: 12 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: "600" },
  cardDesc: { fontSize: 14, color: theme.muted, marginTop: 2 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 8 },
});