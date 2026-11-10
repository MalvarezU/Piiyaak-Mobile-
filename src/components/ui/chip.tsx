/**
 * Cápsula estática de metadatos (`label`) con tres tonos: neutral,
 * success y accent. No es táctil: si un día necesita interacción se
 * extiende a Pressable con el `minHit` del token, sin cambiar esta API
 * visual. Texto: `type.caption` con la familia sansMedium del token.
 */
import { View, Text, StyleSheet } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { theme, fonts, radiusScale, spacing, type } from "../../theme";

export type ChipTone = "neutral" | "success" | "accent";

export interface ChipProps {
  label: string;
  tone?: ChipTone;
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
  label: {
    ...type.caption,
    fontFamily: fonts.sansMedium,
  },
});

export function Chip({ label, tone = "neutral", style }: ChipProps) {
  return (
    <View style={[styles.base, styles[tone], style]}>
      <Text style={[styles.label, { color: FOREGROUND[tone] }]}>{label}</Text>
    </View>
  );
}
