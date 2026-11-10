/**
 * Hub de Juegos — rediseño visual de la Fase 2: kit base (Screen, Card,
 * ThemedText) y tokens de src/theme.ts. La lógica de navegación queda
 * intacta: store del contexto, ruta por id (/juegos/[id]) y sin navegación
 * mientras el diccionario no esté listo (Card estática; la nota explica
 * por qué). Los emojis se reemplazan 1:1 por íconos lucide.
 */
import { ScrollView, View, StyleSheet } from "react-native";
import { ArrowRight, Brain, ListChecks, PencilLine, Puzzle } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { theme, type, fonts, spacing, radiusScale } from "../../theme";
import { Screen, ThemedText, Card } from "../../components/ui";

/** Juegos del diccionario: ícono lucide + ruta bajo /juegos/[id]. */
const GAMES = [
  { id: "flashcards", title: "Flashcards", desc: "Opción múltiple ES ↔ Nasa Yuwe", icon: ListChecks },
  { id: "memoria", title: "Memoria", desc: "Empareja español y Nasa Yuwe", icon: Brain },
  { id: "completar", title: "Completar", desc: "Completa la traducción", icon: PencilLine },
  { id: "ordena", title: "Ordena", desc: "Ordena las fichas de la palabra", icon: Puzzle },
] as const;

export default function JuegosHub() {
  const { store } = useDb();
  const router = useRouter();

  return (
    <Screen>
      <ScrollView
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <ThemedText variant="title">Juegos</ThemedText>
          <ThemedText variant="body" style={styles.subtitle}>
            Practica con el diccionario (100% offline)
          </ThemedText>
        </View>
        <View style={styles.tiles}>
          {GAMES.map((g) => (
            <Card
              key={g.id}
              onPress={store ? () => router.push(`/juegos/${g.id}` as any) : undefined}
            >
              <View style={styles.row}>
                <View style={styles.iconBox}>
                  <g.icon size={24} color={theme.primary} />
                </View>
                <View style={styles.tileBody}>
                  <ThemedText variant="bodyMedium" style={styles.tileTitle}>
                    {g.title}
                  </ThemedText>
                  <ThemedText variant="caption">{g.desc}</ThemedText>
                </View>
                <ArrowRight size={16} color={theme.primary} />
              </View>
            </Card>
          ))}
        </View>
        {!store ? (
          <ThemedText variant="body" style={styles.pending}>
            Preparando diccionario...
          </ThemedText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: { gap: spacing.xs },
  subtitle: { color: theme.muted },
  tiles: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBox: {
    width: spacing.xl,
    height: spacing.xl,
    borderRadius: radiusScale.md,
    borderCurve: "continuous",
    backgroundColor: theme.successSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tileBody: {
    flex: 1,
    gap: spacing.xs,
  },
  tileTitle: {
    // Familia sans semibold: patrón de listas de Home (ramp base del
    // variant + familia), sin fontSizes crudos.
    ...type.bodyMedium,
    fontFamily: fonts.sansSemibold,
  },
  pending: { color: theme.muted },
});
