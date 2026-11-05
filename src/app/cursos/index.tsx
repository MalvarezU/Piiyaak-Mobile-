import { useEffect, useState } from "react";
import { FlatList, Image, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useDb } from "../../db-context";
import { useAuth } from "../../auth";
import { SQLiteCourseStore } from "../../db/course-store";
import { syncCourses, flushCourseProgress } from "../../db/sync-courses";
import { openDatabaseSync } from "expo-sqlite";
import { theme } from "../../theme";
import type { CourseRow } from "../../db/course-types";

export default function Cursos() {
  const { store, ready } = useDb();
  const { session } = useAuth();
  const [wordStore, setWordStore] = useState<any>(null);
  const router = useRouter();
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [courseStore, setCourseStore] = useState<SQLiteCourseStore | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const db = openDatabaseSync("piiyaak.db");
      const cs = await SQLiteCourseStore.open(db);
      if (alive) setCourseStore(cs);
    })();
    return () => { alive = false; };
  }, [store]);

  const loadCourses = async () => {
    if (!courseStore) return;
    const cs = await courseStore.getCourses();
    setCourses(cs);
  };

  useEffect(() => {
    loadCourses();
  }, [courseStore]);

  const handleSync = async () => {
    if (!courseStore) return;
    setSyncing(true);
    try {
      await syncCourses(courseStore, session);
      if (store && session) {
        await flushCourseProgress(courseStore, store, session);
      }
      await loadCourses();
    } catch (e) {
      console.error("sync courses error", e);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Cursos</Text>
      <TouchableOpacity style={styles.syncBtn} onPress={handleSync} disabled={syncing || !courseStore}>
        <Text style={styles.syncText}>{syncing ? "Sincronizando..." : "Sincronizar cursos"}</Text>
      </TouchableOpacity>
      <FlatList
        data={courses}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/cursos/[id]", params: { id: item.id } })}
          >
            {item.coverImage ? <Image source={{ uri: item.coverImage }} style={styles.cover} resizeMode="cover" /> : null}
            <Text style={styles.cardTitle}>{item.title}</Text>
            {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.muted}>Sin cursos. Sincroniza para descargar.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: theme.primary, textAlign: "center", marginBottom: 12 },
  syncBtn: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 10, alignItems: "center", marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  syncText: { fontSize: 15, fontWeight: "600", color: theme.primary },
  card: { backgroundColor: theme.card, borderRadius: theme.radius, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  cover: { width: "100%", height: 120, borderRadius: theme.radius, marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: "600" },
  cardDesc: { fontSize: 14, color: theme.muted, marginTop: 4 },
  muted: { color: theme.muted, textAlign: "center", marginTop: 32 },
});