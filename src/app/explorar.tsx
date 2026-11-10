/**
 * Explorar — Diccionario de la A a la Z: filtro por categoría y listado
 * agrupado por letra inicial (encabezados de grupo con recuento). El
 * rediseño es visual (kit base, src/components/ui); la lógica de datos
 * —store, sync, paginación por lotes y reseteo de página al cambiar de
 * filtro— queda intacta.
 */
import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen, Volume2 } from "lucide-react-native";
import { useDb } from "../db-context";
import { EmptyState } from "../components/empty-state";
import { theme, fonts, spacing, radiusScale, type } from "../theme";
import { Screen, ThemedText, Card, Chip } from "../components/ui";
import type { WordRow } from "../db/types";

/**
 * Primera letra del español en mayúscula, insensible a tildes: la cadena
 * se normaliza a NFD y se descartan los signos diacríticos (Á → A).
 * Dato anómalo (spanish vacío): el grupo cae bajo "#", nunca rompe la
 * lista ni el cálculo de orden siguiente.
 */
const letterOf = (spanish: string): string => {
  const base = spanish.trim().normalize("NFD").replace(/\u0300-\u036f/g, "");
  return base ? base.charAt(0).toUpperCase() : "#";
};

export default function Explorar() {
  const { store, sync } = useDb();
  const router = useRouter();
  const [words, setWords] = useState<WordRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
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

  // Reset de la paginación al cambiar el filtro de categoría.
  useEffect(() => {
    setPage(0);
    setWords([]);
  }, [category]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sync();
      setPage(0);
      setWords([]);
    } finally {
      setRefreshing(false);
    }
  };

  /** Recuento de palabras por letra en la página cargada (encabezados A-Z). */
  const letterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of words) {
      const letter = letterOf(w.spanish);
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
    return counts;
  }, [words]);

  // "Todas" primero (sin filtro); el resto proviene del almacenamiento.
  const filters: { label: string; value: string | null }[] = [
    { label: "Todas", value: null },
    ...categories.map((c) => ({ label: c, value: c })),
  ];

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText variant="title">Índice Alfabético</ThemedText>
        <ThemedText variant="body" style={styles.subtitle}>
          De la A a la Z
        </ThemedText>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catBar}
        contentContainerStyle={styles.catContent}
      >
        {filters.map((f) => (
          <Chip
            key={f.value ?? "todas"}
            label={f.label}
            selected={category === f.value}
            onPress={() => setCategory(f.value)}
          />
        ))}
      </ScrollView>
      <ThemedText variant="caption" style={styles.count}>
        {words.length} de {total} palabras
      </ThemedText>
      {words.length === 0 ? (
        <EmptyState message="Sin palabras en esta categoría" icon="📚" />
      ) : null}
      <FlatList
        data={words}
        keyExtractor={(w) => w.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.montana}
            colors={[theme.montana]}
          />
        }
        renderItem={({ item, index }) => {
          const letter = letterOf(item.spanish);
          const prev = index > 0 ? words[index - 1] : undefined;
          const showHeader = !prev || letterOf(prev.spanish) !== letter;
          const count = letterCounts.get(letter) ?? 0;
          return (
            <>
              {showHeader ? (
                <View style={styles.letterHeader}>
                  <View style={styles.accentBar} />
                  <View style={styles.letterBody}>
                    <ThemedText variant="word" accessibilityRole="header">
                      {letter}
                    </ThemedText>
                    <ThemedText variant="caption">
                      {count === 1 ? "1 palabra" : `${count} palabras`}
                    </ThemedText>
                  </View>
                </View>
              ) : null}
              <Card
                onPress={() =>
                  router.push({ pathname: "/ficha/[id]", params: { id: item.id } })
                }
              >
                <View style={styles.row}>
                  <View style={styles.rowBody}>
                    <View style={styles.wordsRow}>
                      <ThemedText variant="bodyMedium">{item.spanish}</ThemedText>
                      <ThemedText variant="body" style={styles.dash}>
                        —
                      </ThemedText>
                      <ThemedText variant="body" style={styles.nasaYuwe}>
                        {item.nasaYuwe}
                      </ThemedText>
                    </View>
                    {item.pronunciation ? (
                      <View style={styles.metaRow}>
                        <Volume2 size={16} color={theme.primary} />
                        <ThemedText variant="caption">{item.pronunciation}</ThemedText>
                      </View>
                    ) : null}
                    {item.category ? <Chip label={item.category} tone="accent" /> : null}
                  </View>
                  <BookOpen size={16} color={theme.primary} />
                </View>
              </Card>
            </>
          );
        }}
        onEndReached={() => {
          if (words.length < total) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.5}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  subtitle: { color: theme.muted },
  catBar: { flexGrow: 0, marginTop: spacing.md },
  catContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  count: {
    marginTop: spacing.mid,
    paddingHorizontal: spacing.md,
    fontVariant: ["tabular-nums"],
  },
  list: { flex: 1, marginTop: spacing.sm },
  listContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  letterHeader: {
    flexDirection: "row",
    backgroundColor: theme.successSoft,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  accentBar: {
    // Barra de acento izquierda de 4px: ancho del paso xs de la grilla.
    width: spacing.xs,
    alignSelf: "stretch",
    backgroundColor: theme.primary,
  },
  letterBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: spacing.mid,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  wordsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  dash: { color: theme.muted },
  nasaYuwe: {
    // Familia serif de contenido (regla web): token base del ramp + serif.
    ...type.body,
    fontFamily: fonts.serif,
    color: theme.primary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
});
