import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { resetRequest } from "../api";
import { theme } from "../theme";

export default function Resetear() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleReset() {
    if (!token.trim() || password.length < 8) {
      setMessage("Token y contraseña (mín. 8) son requeridos.");
      return;
    }
    setLoading(true);
    const r = await resetRequest(token.trim(), password);
    setLoading(false);
    setMessage(r.message);
    if (r.ok) {
      setTimeout(() => router.replace("/"), 1500);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Nueva contraseña</Text>
      <TextInput
        style={styles.input}
        placeholder="Token (del enlace)"
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Nueva contraseña (mín. 8)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={handleReset} disabled={loading}>
        <Text style={styles.btnText}>{loading ? "..." : "Actualizar"}</Text>
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
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  msg: { color: theme.muted },
});