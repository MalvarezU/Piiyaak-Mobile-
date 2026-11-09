/**
 * W3 — "Preparando contenido…" (spec §4.2). Componente presentacional:
 * recibe `SeedState` y callbacks; la lógica vive en `seed-machine.ts`.
 * Accesible (progressbar con valores, alert en error) y táctil (≥ 44pt).
 */
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { theme } from "../theme";
import {
  seedStatusCopy,
  type SeedState,
} from "../db/seed-machine";

interface SeedProgressProps {
  state: SeedState;
  onRetry: () => void;
  onTextOnly: () => void;
}

export function SeedProgress({ state, onRetry, onTextOnly }: SeedProgressProps) {
  const copy = seedStatusCopy(state);
  const progress =
    state.status === "downloading" ? state.progress : null;
  const pct =
    progress && progress.totalBytes > 0
      ? Math.min(1, progress.receivedBytes / progress.totalBytes)
      : 0;
  const failed = state.status === "error";

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{copy.title}</Text>
      {copy.detail && !failed ? <Text style={styles.detail}>{copy.detail}</Text> : null}
      {progress ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: progress.totalBytes, now: progress.receivedBytes }}
          accessibilityLabel="Progreso de descarga del contenido"
          style={styles.track}
        >
          <View style={[styles.fill, { flex: pct, minWidth: pct > 0 ? 8 : 0 }]} />
          <View style={{ flex: Math.max(0, 1 - pct) }} />
        </View>
      ) : null}
      {failed ? (
        <View accessibilityRole="alert">
          <Text style={styles.errorHint}>El diccionario de texto sigue disponible.</Text>
          <View style={styles.row}>
            {state.canRetry ? (
              <TouchableOpacity style={styles.btn} onPress={onRetry} accessibilityRole="button">
                <Text style={styles.btnText}>Reintentar</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.btnGhost} onPress={onTextOnly} accessibilityRole="button">
              <Text style={styles.btnGhostText}>Continuar solo con texto</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  title: { fontSize: 16, fontWeight: "600", textAlign: "center" },
  detail: { fontSize: 14, color: theme.muted, textAlign: "center", marginTop: 4 },
  track: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.border,
    overflow: "hidden",
    marginTop: 12,
  },
  fill: { backgroundColor: theme.primary, borderRadius: 4 },
  errorHint: { fontSize: 14, color: theme.muted, textAlign: "center", marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12 },
  btn: {
    backgroundColor: theme.primary,
    borderRadius: theme.radius,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
  },
  btnText: { color: "#ffffff", fontWeight: "600", fontSize: 16 },
  btnGhost: {
    borderRadius: theme.radius,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
  },
  btnGhostText: { fontWeight: "600", fontSize: 16, color: theme.text },
});
