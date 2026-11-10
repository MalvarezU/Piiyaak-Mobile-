/**
 * Cápsula de metadatos con tres tonos: neutral, success y accent. Con
 * `onPress` se vuelve táctil: Pressable con el `minHit` del token y
 * feedback de presión al 0.92 (mismo gesto que Card), conservando la
 * superficie visual del tono. `selected` marca el estado activo de un
 * filtro (fondo theme.primary + texto onTint) y prevalece sobre el
 * tono. Sin `onPress` el contrato estático original queda intacto.
 * Texto: `type.caption` con la familia sansMedium del token.
 */
import { Pressable, View, Text, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { theme, fonts, radiusScale, spacing, type, minHit } from "../../theme";

export type ChipTone = "neutral" | "success" | "accent";

export interface ChipProps {
  label: string;
  tone?: ChipTone;
  /** Estado activo de un filtro: fondo primary con texto onTint. */
  selected?: boolean;
  /** Al definirla la cápsula es táctil (Pressable con minHit). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Color del texto por tono (el fondo vive en el StyleSheet). */
const FOREGROUND: Record<ChipTone, string> = {
  neutral: theme.muted,
  success: theme.success,
  accent: theme.montanaDeep,
};

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    borderRadius: radiusScale.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  neutral: {
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.border,
  },
  success: { backgroundColor: theme.successSoft },
  accent: { backgroundColor: theme.amarilloTierra },
  selected: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  tappable: {
    // Los píxeles restantes completan la zona táctil mínima del token.
    minHeight: minHit,
    justifyContent: "center",
  },
  pressed: { opacity: 0.92 },
  label: {
    ...type.caption,
    fontFamily: fonts.sansMedium,
  },
});

export function Chip({
  label,
  tone = "neutral",
  selected = false,
  onPress,
  style,
}: ChipProps) {
  const surface = selected ? styles.selected : styles[tone];
  const color = selected ? theme.onTint : FOREGROUND[tone];
  if (!onPress) {
    return (
      <View style={[styles.base, surface, style]}>
        <Text style={[styles.label, { color }]}>{label}</Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles.tappable,
        surface,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}
