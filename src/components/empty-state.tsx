import { Text, View, StyleSheet } from "react-native";
import { theme } from "../theme";

export interface EmptyStateProps {
  message: string;
  icon?: string;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  icon: { fontSize: 32, marginBottom: 8 },
  message: { color: theme.muted, textAlign: "center", fontSize: 15, lineHeight: 22 },
});