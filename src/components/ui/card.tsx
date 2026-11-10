/**
 * Contenedor base del kit: superficie blanca con radio, borde, sombra y
 * curva continua del token. Con `onPress` es táctil (feedback de presión
 * al 0.92, nunca hover); sin él es estático. El contenido es `children`:
 * el componente no describe datos, solo estructura.
 */
import { Pressable, View, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { theme, radiusScale, spacing, shadows } from "../../theme";

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: theme.card,
    borderRadius: radiusScale.md,
    borderWidth: 1,
    borderColor: theme.border,
    boxShadow: shadows.card,
    borderCurve: "continuous",
    padding: spacing.mid,
  },
  pressed: { opacity: 0.92 },
});

export function Card({ children, onPress, style }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.base, pressed ? styles.pressed : null, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.base, style]}>{children}</View>;
}
