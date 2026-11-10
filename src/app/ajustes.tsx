import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { useAuth, AUTH_UI_ENABLED } from "../auth";
import { useDb } from "../db-context";
import { useRouter } from "expo-router";
import { theme } from "../theme";

export default function Ajustes() {
  const { session, login, logout } = useAuth();
  const { ready, syncing, syncProgress, lastSync, sync, syncData, store, pendingOutboxCount } = useDb();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);

  async function handleLogin() {
    setError(null);
    const ok = await login(email, password);
    // El login con email+contraseña sigue intacto. Si falla, puede ser una
    // cuenta creada con Google que aún no tiene contraseña web (el flujo
    // de credenciales no expone códigos, así que el hint va en el copy).
    if (!ok)
      setError(
        "No se pudo entrar. Revisa tus datos o tu conexión. Si creaste tu cuenta con Google, creá tu contraseña en tu perfil de la web e intentá de nuevo."
      );
  }

  async function handleSync() {
    await sync();
    if (store) setCount(await store.count());
  }

  return (
    <View style={styles.root}>
      {AUTH_UI_ENABLED ? (
        <>
      <Text style={styles.h}>Cuenta</Text>
      {session ? (
        <>
          <Text style={styles.row}>{session.user.email}</Text>
          <TouchableOpacity style={styles.btnGhost} onPress={logout}>
            <Text style={styles.btnGhostText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Correo"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Contraseña"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.link} onPress={() => router.push("/registro")}>
        <Text style={styles.linkText}>Crear cuenta en la web</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => router.push("/recuperar")}>
        <Text style={styles.linkText}>Olvidé mi contraseña</Text>
      </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={handleLogin}>
            <Text style={styles.btnText}>Entrar</Text>
          </TouchableOpacity>
        </>
      )}
        </>
      ) : null}

      <Text style={styles.h}>Sincronización</Text>
      <Text style={styles.row}>
        Estado: {!ready ? "preparando..." : syncing ? (syncProgress ? `sincronizando ${syncProgress.done}/${syncProgress.total}` : "sincronizando...") : "lista"}
      </Text>
      <Text style={styles.row}>
        Última sincronización: {lastSync ? new Date(lastSync).toLocaleString() : "nunca"}
      </Text>
      {count !== null && <Text style={styles.row}>Palabras locales: {count}</Text>}
      <Text style={styles.row}>Cambios pendientes: {pendingOutboxCount}</Text>
      <TouchableOpacity style={styles.btn} onPress={handleSync} disabled={!ready || syncing}>
        <Text style={styles.btnText}>Sincronizar ahora</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.btnGhost} onPress={syncData} disabled={syncing}>
        <Text style={styles.btnGhostText}>Sincronizar datos</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background, padding: 16, gap: 8 },
  h: { fontSize: 18, fontWeight: "bold" as const, color: theme.primary, marginTop: 12 },
  row: { fontSize: 15 },
  input: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 12, fontSize: 16 },
  btn: { backgroundColor: theme.primary, borderRadius: theme.radius, padding: 14, alignItems: "center" as const, marginTop: 4 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  btnGhost: { padding: 12, alignItems: "center" as const },
  btnGhostText: { color: theme.danger, fontSize: 15 },
  error: { color: theme.danger },
  link: { padding: 8, alignItems: "center" as const },
  linkText: { color: theme.primary, fontSize: 15 },
});
