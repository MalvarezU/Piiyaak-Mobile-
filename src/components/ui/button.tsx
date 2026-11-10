/**
 * Botón del kit con tres variantes (primary/secondary/ghost). El estado
 * presionado cambia el fondo (táctil, sin hover); `loading` reemplaza el
 * título por un spinner del color de la variante y expone busy/disabled
 * accesible. Zona táctil mínima del token (44pt).
 */
import { Pressable, ActivityIndicator, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { theme, radiusScale, spacing, shadows, minHit } from "../../theme";
import { ThemedText } from "./themed-text";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Color del texto/spinner por variante (el fondo vive en el StyleSheet). */
const FOREGROUND: Record<ButtonVariant, string> = {
  primary: theme.onTint,
  secondary: theme.primary,
  ghost: theme.primary,
};

const styles = StyleSheet.create({
  base: {
    minHeight: minHit,
    borderRadius: radiusScale.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  primary: {
    backgroundColor: theme.primary,
    boxShadow: shadows.raised,
  },
  primaryPressed: { backgroundColor: theme.montanaDeep },
  secondary: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryPressed: { backgroundColor: theme.background },
  ghost: { backgroundColor: "transparent" },
  // Montana al 8%: superficie de presión local del kit (contrato; es
  // `theme.montana` con canal alfa, no un color nuevo del sistema).
  ghostPressed: { backgroundColor: "rgba(23, 63, 53, 0.08)" },
  disabled: { opacity: 0.5 },
});

const PRESSED: Record<ButtonVariant, ViewStyle> = {
  primary: styles.primaryPressed,
  secondary: styles.secondaryPressed,
  ghost: styles.ghostPressed,
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !inactive ? PRESSED[variant] : null,
        inactive ? styles.disabled : null,
        style,
      ]}
    >
      {!loading && icon ? icon : null}
      {loading ? (
        <ActivityIndicator color={FOREGROUND[variant]} />
      ) : (
        <ThemedText variant="bodyStrong" style={{ color: FOREGROUND[variant] }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}
