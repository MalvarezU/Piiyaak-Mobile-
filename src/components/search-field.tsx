/**
 * Campo de búsqueda del home: ícono + TextInput + X + Cancelar.
 *
 * Vive en el kit de componentes (no en la pantalla) para no duplicar JSX.
 * La pantalla lo monta UNA sola vez y nunca lo desmonta: si el input se
 * desmontara al escribir, el teclado se cerraría a mitad de la búsqueda.
 * Estilos solo con tokens de src/theme.ts.
 */
import { Pressable, TextInput, View, StyleSheet } from "react-native";
import { Search, X } from "lucide-react-native";
import { theme, type, radiusScale, spacing, minHit } from "../theme";
import { ThemedText } from "./ui";

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  /** Limpia el texto sin cerrar el teclado (sigue escribiendo). */
  onClear: () => void;
  /** Limpia y cierra el teclado, restaurando el home. */
  onCancel: () => void;
  /** Hay texto: se muestra el botón Cancelar. */
  searchMode: boolean;
}

export function SearchField({
  value,
  onChangeText,
  onClear,
  onCancel,
  searchMode,
}: SearchFieldProps) {
  return (
    <View style={styles.row}>
      <View style={styles.field} accessibilityRole="search">
        <Search size={20} color={theme.muted} />
        <TextInput
          style={styles.input}
          placeholder="Buscar palabra..."
          placeholderTextColor={theme.muted}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Buscar palabra"
        />
        {value.length > 0 ? (
          <Pressable
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Limpiar búsqueda"
            hitSlop={8}
            style={styles.clear}
          >
            <X size={18} color={theme.muted} />
          </Pressable>
        ) : null}
      </View>
      {searchMode ? (
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancelar búsqueda"
          hitSlop={8}
          style={styles.cancel}
        >
          <ThemedText variant="label" style={styles.cancelText}>
            Cancelar
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minHit,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radiusScale.full,
    paddingHorizontal: spacing.md,
  },
  input: {
    ...type.body,
    flex: 1,
    textAlignVertical: "center",
  },
  clear: { padding: spacing.xs },
  cancel: { minHeight: minHit, justifyContent: "center" },
  cancelText: { color: theme.primary },
});
