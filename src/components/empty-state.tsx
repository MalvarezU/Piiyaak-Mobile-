import { Text, View, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import { theme } from "../theme";

export interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
  /** "onPhoto": texto en crema de contraste sobre foto; default intacto. */
  tone?: "default" | "onPhoto";
}

export function EmptyState({ message, icon, tone = "default" }: EmptyStateProps) {
  const onPhoto = tone === "onPhoto";
  return (
    <View style={styles.root}>
      {icon
        ? typeof icon === "string"
          ? <Text style={[styles.icon, onPhoto ? styles.onPhoto : null]}>{icon}</Text>
          : icon
        : null}
      <Text style={[styles.message, onPhoto ? styles.onPhoto : null]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  icon: { fontSize: 32, marginBottom: 8 },
  message: { color: theme.muted, textAlign: "center", fontSize: 15, lineHeight: 22 },
  onPhoto: { color: theme.onTint },
});