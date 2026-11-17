/**
 * Home de Piiyaak: búsqueda → avisos → sugeridas → módulos → resultados.
 *
 * Modo búsqueda: con texto en el campo, el carrusel de sugeridas y los
 * tiles de módulos se ocultan con `display: "none"` (no se desmontan: el
 * TextInput es único y permanente, así el teclado nunca se cierra solo).
 * La FlatList de resultados es hermana del input dentro del mismo
 * KeyboardAvoidingView, con flex:1: ocupa exactamente el espacio entre el
 * input y el teclado. En Android el ajuste lo hace `adjustResize` (sin
 * padding extra, que duplicaría el recorte); en iOS se usa
 * behavior="padding" (iOS no redimensiona la ventana).
 *
 * UpdateNotice y SeedProgress quedan fuera del bloque ocultable: son
 * estado crítico y siguen visibles mientras se busca. La lógica de
 * datos —debounce, palabra del día, sync, semilla, avisos— queda intacta.
 */
import { useEffect, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  View,
  StyleSheet,
} from "react-native";
import { BookOpen, Gamepad2, GraduationCap } from "lucide-react-native";
import { useRouter } from "expo-router";
import { theme, fonts, type, spacing } from "../theme";
import { Screen, ThemedText, Card } from "../components/ui";
import { useDb } from "../db-context";
import { EmptyState } from "../components/empty-state";
import { SeedProgress } from "../components/seed-progress";
import { Reveal } from "../components/motion";
import { UpdateNotice } from "../components/update-notice";
import { SearchField } from "../components/search-field";
import type { WordRow } from "../db/types";
import { loadSuggestedWords } from "../db/suggested-words";
import { SuggestedWordsCarousel } from "../components/suggested-words-carousel";

/** Módulos del home: ícono lucide + ruta del Tab correspondiente. */
const MODULES = [
  { title: "Diccionario", icon: BookOpen, href: "/explorar" },
  { title: "Juegos", icon: Gamepad2, href: "/juegos" },
  { title: "Cursos", icon: GraduationCap, href: "/cursos" },
] as const;

/** Fondo fotográfico del home: tarjeta compuesta (blur-fill + nítida). */
const HOME_BACKGROUND = {
  source: require("../../assets/images/encuentro-nasa-yuwe.jpg"),
};

export default function Inicio() {
  const { store, ready, sync, lastSync, seedState, retrySeed, continueTextOnly, updateAvailable, acceptUpdate, dismissUpdate } = useDb();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WordRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [suggested, setSuggested] = useState<WordRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Con texto hay modo búsqueda (oculta home, muestra lista). Con 2+
  // caracteres además se consulta, con debounce de 250ms. `isSearching`
  // distingue "consulta en vuelo" de "resolvió vacía" para no parpadear
  // "Sin resultados" mientras se escribe.
  useEffect(() => {
    let alive = true;
    if (!store || q.trim().length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const t = setTimeout(async () => {
      const r = await store.search(q.trim(), 20);
      if (alive) {
        setResults(r);
        setIsSearching(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, store]);

  // Palabras sugeridas (cálculo local, determinista por fecha).
  // Se re-resuelve cuando cambia lastSync: tras un sync el vocabulario
  // puede traer ids nuevos.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const today = new Date().toISOString().slice(0, 10);
      try {
        const words = await loadSuggestedWords(store, today);
        if (alive) setSuggested(words);
      } catch {
        // offline sin caché: no hay palabras sugeridas
      }
    })();
    return () => {
      alive = false;
    };
  }, [store, lastSync]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await sync();
    } finally {
      setRefreshing(false);
    }
  };

  const handleClear = () => {
    setQ("");
  };

  const handleCancel = () => {
    setQ("");
    Keyboard.dismiss();
  };

  const searchMode = q.trim().length > 0;
  const queryActive = q.trim().length >= 2;

  return (
    <Screen background={HOME_BACKGROUND}>
      <KeyboardAvoidingView
        style={styles.avoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View testID="search-header" style={styles.searchHeader}>
          <SearchField
            value={q}
            onChangeText={setQ}
            onClear={handleClear}
            onCancel={handleCancel}
            searchMode={searchMode}
            onPhoto
          />
        </View>
        {updateAvailable ? (
          <View style={styles.notices}>
            <UpdateNotice
              update={updateAvailable}
              onDownload={() => {
                void acceptUpdate();
              }}
              onLater={dismissUpdate}
            />
          </View>
        ) : null}
        {seedState ? (
          <View style={styles.notices}>
            <SeedProgress state={seedState} onRetry={retrySeed} onTextOnly={continueTextOnly} />
          </View>
        ) : !ready ? (
          <View style={styles.notices}>
            <ThemedText variant="body" style={[styles.muted, styles.onPhoto]}>
              Preparando diccionario offline...
            </ThemedText>
          </View>
        ) : null}
        <View
          testID="home-sugeridas"
          style={[styles.homeBlock, searchMode ? styles.hidden : null]}
        >
          {suggested.length > 0 ? (
            <Reveal delay={0}>
              <View>
                <ThemedText variant="caption" style={[styles.wodLabel, styles.onPhoto]}>
                  Palabras sugeridas
                </ThemedText>
                <SuggestedWordsCarousel
                  words={suggested}
                  onPressWord={(id) => router.push({ pathname: "/ficha/[id]", params: { id } })}
                />
              </View>
            </Reveal>
          ) : null}
        </View>
        <View
          testID="home-modulos"
          style={[styles.homeBlock, searchMode ? styles.hidden : null]}
        >
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
        </View>
        <FlatList
          testID="lista-resultados"
          data={results}
          keyExtractor={(w) => w.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            queryActive ? (
              isSearching ? (
                <View style={styles.status}>
                  <ThemedText variant="body" style={[styles.muted, styles.onPhoto]}>
                    Buscando…
                  </ThemedText>
                </View>
              ) : results.length === 0 ? (
                <EmptyState message="Sin resultados" icon="🔍" tone="onPhoto" />
              ) : null
            ) : null
          }
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
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avoider: { flex: 1 },
  searchHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  notices: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  homeBlock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  hidden: { display: "none" },
  wodLabel: { textTransform: "uppercase" },
  tiles: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  muted: { color: theme.muted, textAlign: "center" },
  onPhoto: { color: theme.onTint },
  list: { flex: 1 },
  listContent: {
    flexGrow: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  status: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
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
