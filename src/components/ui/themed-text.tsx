/**
 * Texto del sistema: las pantallas eligen una variante del ramp `type`
 * (src/theme.ts) y nunca escriben fontSizes crudos. El `style` del
 * llamador se fusiona al final, para ajustes de layout (colores, margins)
 * sin encubrir la identidad tipográfica.
 */
import { Text, type TextProps, type StyleProp, type TextStyle } from "react-native";
import { type } from "../../theme";

type TextVariant = keyof typeof type;

export interface ThemedTextProps extends TextProps {
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
}

export function ThemedText({ variant = "body", style, ...props }: ThemedTextProps) {
  return <Text style={[type[variant], style]} {...props} />;
}
