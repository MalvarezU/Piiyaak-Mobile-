/**
 * Explorar — Diccionario de la A a la Z: filtro por categoría y listado
 * agrupado por letra inicial (encabezados de grupo con recuento). Sobre el
 * kit base (src/components/ui), la lógica de datos cubre sync, paginación
 * por lotes, reseteo de página al cambiar de filtro, cerrojo contra dobles
 * disparos de onEndReached y nonce de refresco manual a página 0. El
 * recuento global solo se muestra sin filtro: count() no filtrado no
 * refleja la categoría activa.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, ScrollView, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { BookOpen, Volume2 } from "lucide-react-native";
import { useDb } from "../db-context";
import { EmptyState } from "../components/empty-state";
import { theme, fonts, spacing, radiusScale, type } from "../theme";
import { Screen, ThemedText, Card, Chip } from "../components/ui";
import { Reveal } from "../components/motion";
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
  // Nonce de refresco manual: fuerza el re-fetch aun cuando page ya es 0.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Cerrojo de consulta en vuelo: bloquea dobles disparos de onEndReached.
  const fetchingRef = useRef(false);
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
    // Respeta el cerrojo: si ya hay una consulta en vuelo, esta
    // ejecución no encadena otra.
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    (async () => {
      try {
        if (!store) return;
        const [rows, n] = await Promise.all([
          store.listAZ(category, PAGE, page * PAGE),
          store.count(),
        ]);
        if (!alive) return;
        setWords((prev) => (page === 0 ? rows : [...prev, ...rows]));
        setTotal(n);
      } finally {
        // Se libera solo si esta ejecución sigue vigente; en caso
        // contrario el cleanup ya liberó el cerrojo.
        if (alive) fetchingRef.current = false;
      }
    })();
    return () => {
      alive = false;
      // El cerrojo es del componente: se libera en desmonte y en cada
      // re-ejecución del effect.
      fetchingRef.current = false;
    };
  }, [store, page, category, refreshNonce]);

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
      // Con page ya en 0 el setPage no dispara el effect: el nonce sí.
      setRefreshNonce((n) => n + 1);
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
      <Reveal delay={0}>
        <View style={styles.header}>
          <ThemedText variant="title">Índice Alfabético</ThemedText>
          <ThemedText variant="body" style={styles.subtitle}>
            De la A a la Z
          </ThemedText>
        </View>
      </Reveal>
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
        {/* Sin filtro: progreso paginación. Con filtro: count() es global
            y no refleja el filtro; solo el recuento local es honesto. */}
        {category === null
          ? `${words.length} de ${total} palabras`
          : `${words.length} palabra${words.length === 1 ? "" : "s"}`}
      </ThemedText>
      {words.length === 0 ? (
        <EmptyState message="Sin palabras en esta categoría" icon={<BookOpen size={32} color={theme.muted} />} />
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
          // RN puede disparar dos veces con fetch en vuelo: sin cerrojo,
          // page avanza dos veces y se pierde un lote entero.
          if (fetchingRef.current) return;
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
