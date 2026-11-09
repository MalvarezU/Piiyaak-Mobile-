/**
 * W2 — aviso de contenido nuevo (spec §W2.5). Componente presentacional:
 * recibe `UpdateAvailable` y callbacks; la decisión vive en
 * `src/db/update-notice.ts`. Reutiliza el lenguaje visual de
 * `SeedProgress` (tarjeta, `theme.card`, botones ≥ 44pt, rol alert).
 * No bloquea: la app sigue operable con el texto local.
 */
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { theme } from "../theme";
import type { UpdateAvailable } from "../db/update-notice";

interface UpdateNoticeProps {
  update: UpdateAvailable;
  onDownload: () => void;
  onLater: () => void;
}

/**
 * MB con un decimal, mismo formato que `formatSeedProgress`
 * (`seed-machine.ts`: divisor 1_000_000, `toFixed(1)`).
 */
function formatNoticeMegabytes(bytesTotal: number): string {
  return `${(bytesTotal / 1_000_000).toFixed(1)} MB`;
}

export function UpdateNotice({ update, onDownload, onLater }: UpdateNoticeProps) {
  const detail =
    update.bytesTotal !== null && update.files !== null
      ? `Versión ${update.remote} · ${formatNoticeMegabytes(update.bytesTotal)} · ${update.files} archivos`
      : `Versión ${update.remote}`;

  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.title}>Hay contenido nuevo disponible</Text>
      <Text style={styles.detail}>{detail}</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={onDownload} accessibilityRole="button">
          <Text style={styles.btnText}>Descargar ahora</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={onLater} accessibilityRole="button">
          <Text style={styles.btnGhostText}>Más tarde</Text>
        </TouchableOpacity>
      </View>
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
