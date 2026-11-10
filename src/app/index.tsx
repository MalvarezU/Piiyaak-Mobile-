/**
 * Home de Piiyaak: palabra del día → avisos → módulos → búsqueda.
 * El rediseño es visual (kit base, src/components/ui); la lógica de
 * datos —debounce, palabra del día, sync, semilla, avisos— queda intacta.
 */
import { useEffect, useState } from "react";
import { FlatList, RefreshControl, TextInput, View, StyleSheet } from "react-native";
import { BookOpen, Gamepad2, GraduationCap, Search } from "lucide-react-native";
import { useRouter } from "expo-router";
import { theme, fonts, type, radiusScale, spacing, minHit } from "../theme";
import { Screen, ThemedText, Card, Chip } from "../components/ui";
import { useDb } from "../db-context";
import { useAuth } from "../auth";
import { EmptyState } from "../components/empty-state";
import { SeedProgress } from "../components/seed-progress";
import { Reveal } from "../components/motion";
import { UpdateNotice } from "../components/update-notice";
import type { WordRow } from "../db/types";
import { loadWordOfDay } from "../db/word-of-day";

/** Módulos del home: ícono lucide + ruta del Tab correspondiente. */
const MODULES = [
  { title: "Diccionario", icon: BookOpen, href: "/explorar" },
  { title: "Juegos", icon: Gamepad2, href: "/juegos" },
  { title: "Cursos", icon: GraduationCap, href: "/cursos" },
] as const;

export default function Inicio() {
  const { store, ready, sync, lastSync, seedState, retrySeed, continueTextOnly, updateAvailable, acceptUpdate, dismissUpdate } = useDb();
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

  // Palabra del día (cacheada por fecha en kv; anónima desde B1).
  // Se re-resuelve cuando cambia lastSync: tras un sync el vocabulario
  // puede traer ids nuevos y el wodId cacheado queda huérfano.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const today = new Date().toISOString().slice(0, 10);
      try {
        const w = await loadWordOfDay(store, today, session);
        if (alive) setWod(w);
      } catch {
        // offline sin caché: no hay palabra del día
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, session, lastSync]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sync();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen>
      <View style={styles.content}>
        {wod ? (
          <Reveal delay={0}>
            <Card onPress={() => router.push({ pathname: "/ficha/[id]", params: { id: wod.id } })}>
              <View style={styles.wodBody}>
                <ThemedText variant="caption" style={styles.wodLabel}>
                  Palabra del día
                </ThemedText>
                <ThemedText variant="word">{wod.nasaYuwe}</ThemedText>
                <ThemedText variant="body" style={styles.wodSpanish}>
                  {wod.spanish}
                </ThemedText>
                {wod.category ? <Chip label={wod.category} tone="accent" /> : null}
              </View>
            </Card>
          </Reveal>
        ) : null}
        {updateAvailable ? (
          <UpdateNotice
            update={updateAvailable}
            onDownload={() => {
              void acceptUpdate();
            }}
            onLater={dismissUpdate}
          />
        ) : null}
        {seedState ? (
          <SeedProgress state={seedState} onRetry={retrySeed} onTextOnly={continueTextOnly} />
        ) : !ready ? (
          <ThemedText variant="body" style={styles.muted}>
            Preparando diccionario offline...
          </ThemedText>
        ) : null}
        <Reveal delay={80}>
          <View style={styles.tiles}>
            {MODULES.map((modulo) => (
              <Card key={modulo.href} onPress={() => router.push(modulo.href)} style={styles.tile}>
                <modulo.icon size={24} color={theme.primary} />
                <ThemedText variant="label">{modulo.title}</ThemedText>
              </Card>
            ))}
          </View>
        </Reveal>
        <View style={styles.search}>
          <Search size={20} color={theme.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar palabra..."
            placeholderTextColor={theme.muted}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
      </View>
      {q.trim().length >= 2 && results.length === 0 ? (
        <EmptyState message="Sin resultados" icon="🔍" />
      ) : null}
      <FlatList
        data={results}
        keyExtractor={(w) => w.id}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.montana}
            colors={[theme.montana]}
          />
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: "/ficha/[id]", params: { id: item.id } })}>
            <View style={styles.rowBody}>
              <ThemedText variant="bodyMedium" style={styles.rowTitle}>
                {item.spanish}
              </ThemedText>
              <ThemedText variant="body" style={styles.rowNy}>
                {item.nasaYuwe}
              </ThemedText>
              {item.category ? <ThemedText variant="caption">{item.category}</ThemedText> : null}
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  wodBody: { gap: spacing.xs, alignItems: "flex-start" },
  wodLabel: { textTransform: "uppercase" },
  wodSpanish: { color: theme.muted },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minHit,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radiusScale.full,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    ...type.body,
    flex: 1,
    textAlignVertical: "center",
  },
  muted: { color: theme.muted, textAlign: "center" },
  list: { flex: 1 },
  listContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  rowBody: { gap: spacing.xs },
  rowTitle: {
    // Título de resultado en serif: token base del ramp + familia serif
    // de contenido (regla web). Sin fontSizes crudos.
    ...type.bodyMedium,
    fontFamily: fonts.serifSemibold,
  },
  rowNy: { ...type.body, color: theme.primary },
});
