/**
 * Ajustes: cuenta + sincronización (kit Fase 2). La sección de sync es
 * la vista canónica del estado de datos: estado, última sync, palabras
 * locales, versión de contenido, pendientes del outbox, progreso en vivo
 * y feedback explícito de éxito/error (antes un sync fallido era
 * silencioso: el error se tragaba sin aviso en UI).
 *
 * Botones con semántica clara:
 * - "Sincronizar ahora" = sync completo (diccionario + seed/update +
 *   medios + cursos + outbox → servidor).
 * - "Enviar cambios pendientes" = SOLO vacía el outbox (aparece únicamente
 *   cuando hay pendientes; antes se llamaba "Sincronizar datos" y no
 *   comunicaba que no baja contenido).
 */
import { useCallback, useEffect, useState } from "react";
import { ScrollView, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  RefreshCw,
} from "lucide-react-native";
import { useAuth, AUTH_UI_ENABLED } from "../auth";
import { useDb } from "../db-context";
import { useRouter } from "expo-router";
import { theme, spacing, radiusScale, fonts } from "../theme";
import { Screen, ThemedText, Card, Button, Chip } from "../components/ui";

/** ISO → "hace 5 min" / "hace 2 h" / "hace 3 d" (fallback: ISO cruda). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

/** Fila etiqueta→valor de la tarjeta de sync. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText variant="caption">{label}</ThemedText>
      <ThemedText variant="body" style={styles.rowValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export default function Ajustes() {
  const { session, login, logout } = useAuth();
  const {
    ready,
    syncing,
    syncProgress,
    lastSync,
    sync,
    syncData,
    store,
    pendingOutboxCount,
  } = useDb();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [contentVersion, setContentVersion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Datos siempre visibles al entrar (antes "Palabras locales" solo
  // aparecía tras presionar sync). Se refresca tras cada sync/outbox.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!store) return;
      const [c, v] = await Promise.all([
        store.count(),
        store.getKV("piiyaak:contentVersion"),
      ]);
      if (alive) {
        setCount(c);
        setContentVersion(v);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [store, lastSync, pendingOutboxCount]);

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

  /** Sync completo con feedback: antes un fallo quedaba sin aviso. */
  const handleSync = useCallback(async () => {
    setFeedback(null);
    try {
      await sync();
      if (store) {
        setCount(await store.count());
        setContentVersion(await store.getKV("piiyaak:contentVersion"));
      }
      setFeedback({ kind: "success", message: "Sincronización completa." });
    } catch {
      setFeedback({
        kind: "error",
        message: "No se pudo sincronizar. Revisá tu conexión e intentá de nuevo.",
      });
    }
  }, [sync, store]);

  /** Solo outbox → servidor (lo que antes llamaba "Sincronizar datos"). */
  const handleSendPending = useCallback(async () => {
    setFeedback(null);
    try {
      await syncData();
      setFeedback({ kind: "success", message: "Cambios enviados al servidor." });
    } catch {
      setFeedback({
        kind: "error",
        message: "No se pudieron enviar los cambios. Revisá tu conexión.",
      });
    }
  }, [syncData]);

  const fraction =
    syncProgress && syncProgress.total > 0
      ? Math.min(1, syncProgress.done / syncProgress.total)
      : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        {AUTH_UI_ENABLED ? (
          <Card style={styles.card}>
            <ThemedText variant="heading" style={styles.sectionTitle}>
              Cuenta
            </ThemedText>
            {session ? (
              <>
                <ThemedText variant="body" style={styles.rowValue}>
                  {session.user.email}
                </ThemedText>
                <Button title="Cerrar sesión" variant="ghost" onPress={logout} />
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Correo"
                  placeholderTextColor={theme.muted}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Contraseña"
                  placeholderTextColor={theme.muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                {error ? (
                  <ThemedText variant="caption" style={styles.error}>
                    {error}
                  </ThemedText>
                ) : null}
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => router.push("/registro")}
                >
                  <ThemedText variant="caption" style={styles.linkText}>
                    Crear cuenta en la web
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => router.push("/recuperar")}
                >
                  <ThemedText variant="caption" style={styles.linkText}>
                    Olvidé mi contraseña
                  </ThemedText>
                </TouchableOpacity>
                <Button title="Entrar" variant="primary" onPress={handleLogin} />
              </>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <ThemedText variant="heading" style={styles.sectionTitle}>
            Sincronización
          </ThemedText>

          <View style={styles.rowWrap}>
            <Chip
              label={
                !ready ? "Preparando…" : syncing ? "Sincronizando…" : "Al día"
              }
              tone={!ready ? "neutral" : syncing ? "accent" : "success"}
            />
            {contentVersion ? (
              <Chip label={`Contenido v${contentVersion}`} tone="neutral" />
            ) : null}
          </View>

          <Row
            label="Última sincronización"
            value={lastSync ? relativeTime(lastSync) : "nunca"}
          />
          <Row label="Palabras locales" value={count === null ? "…" : String(count)} />
          <Row label="Cambios pendientes" value={String(pendingOutboxCount)} />

          {syncing && syncProgress ? (
            <>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.round(Math.max(fraction, 0.04) * 100)}%` },
                  ]}
                />
              </View>
              <ThemedText variant="caption">
                {syncProgress.done}/{syncProgress.total}
              </ThemedText>
            </>
          ) : null}

          {feedback ? (
            <View
              style={[
                styles.banner,
                feedback.kind === "success" ? styles.bannerOk : styles.bannerErr,
              ]}
              accessibilityLiveRegion="polite"
            >
              {feedback.kind === "success" ? (
                <CheckCircle2 size={16} color={theme.success} />
              ) : (
                <AlertTriangle size={16} color={theme.danger} />
              )}
              <ThemedText
                variant="caption"
                style={[
                  styles.bannerText,
                  { color: feedback.kind === "success" ? theme.success : theme.danger },
                ]}
              >
                {feedback.message}
              </ThemedText>
            </View>
          ) : null}

          <Button
            title="Sincronizar ahora"
            variant="primary"
            icon={<RefreshCw size={18} color={theme.onTint} />}
            loading={syncing}
            disabled={!ready || syncing}
            onPress={handleSync}
          />
          {pendingOutboxCount > 0 ? (
            <Button
              title={`Enviar cambios pendientes (${pendingOutboxCount})`}
              variant="secondary"
              icon={<CloudUpload size={18} color={theme.primary} />}
              disabled={syncing}
              onPress={handleSendPending}
            />
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.mid, gap: spacing.mid },
  card: { gap: spacing.sm },
  sectionTitle: { marginBottom: spacing.xs },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  rowValue: { color: theme.montanaDeep, fontFamily: fonts.sansMedium },
  progressTrack: {
    height: 6,
    borderRadius: radiusScale.full,
    backgroundColor: theme.border,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.primary,
    borderRadius: radiusScale.full,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radiusScale.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  bannerOk: { backgroundColor: theme.successSoft, borderColor: theme.success },
  bannerErr: { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
  bannerText: { flex: 1 },
  input: {
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 12,
    fontSize: 16,
    color: theme.montanaDeep,
  },
  error: { color: theme.danger },
  link: { padding: 8, alignItems: "center" as const },
  linkText: { color: theme.primary, fontFamily: fonts.sansMedium },
});
