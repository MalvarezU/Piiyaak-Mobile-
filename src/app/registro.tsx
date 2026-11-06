import { Text, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { REGISTRATION_DISABLED_MESSAGE } from "../api";
import { theme } from "../theme";

/**
 * Pantalla informativa (Fase 3 APK, Google-first).
 *
 * Se mantiene como ruta Expo Router para no romper enlaces existentes
 * (ajustes → /registro) ni deep links: en lugar de 404 muestra el aviso.
 * No tiene formulario ni llama al endpoint de registro (410 Gone).
 */
export default function Registro() {
  const router = useRouter();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Crear cuenta</Text>
      <View style={styles.card}>
        <Text style={styles.message}>{REGISTRATION_DISABLED_MESSAGE}</Text>
      </View>
      <TouchableOpacity style={styles.btn} onPress={() => router.replace("/ajustes")}>
        <Text style={styles.btnText}>Ir a entrar</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => router.back()}>
        <Text style={styles.linkText}>Volver</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: "bold", color: theme.primary, textAlign: "center", marginBottom: 12 },
  card: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 16, marginBottom: 8 },
  message: { color: theme.text, fontSize: 16, lineHeight: 24, textAlign: "center" },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
});
