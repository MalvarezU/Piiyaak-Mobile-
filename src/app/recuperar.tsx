import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { recoverRequest } from "../api";
import { theme } from "../theme";

export default function Recuperar() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRecover() {
    if (!email.trim()) {
      setMessage("Ingresa tu correo.");
      return;
    }
    setLoading(true);
    const r = await recoverRequest(email);
    setLoading(false);
    setMessage(r.message);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Recuperar contraseña</Text>
      <Text style={styles.hint}>
        Ingresa tu correo y te enviaremos un enlace para elegir una nueva contraseña.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Correo"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {message ? <Text style={styles.msg}>{message}</Text> : null}
      <TouchableOpacity style={styles.btn} onPress={handleRecover} disabled={loading}>
        <Text style={styles.btnText}>{loading ? "..." : "Enviar enlace"}</Text>
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
  hint: { color: theme.muted, fontSize: 14, marginBottom: 8, lineHeight: 20 },
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { padding: 12, alignItems: "center" },
  linkText: { color: theme.primary, fontSize: 15 },
  msg: { color: theme.muted },
});