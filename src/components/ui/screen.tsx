/**
 * Raíz de pantalla: fondo crema del token y áreas seguras resueltas por
 * react-native-safe-area-context. NO aplica padding horizontal: cada
 * pantalla decide su ritmo de bordes (aquí solo superficie y engranaje
 * con el chrome de navegación).
 */
import { StyleSheet } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../../theme";

export interface ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
  },
});

export function Screen({ children, style }: ScreenProps) {
  return (
    <SafeAreaView style={[styles.root, style]} edges={["top", "bottom"]}>
      {children}
    </SafeAreaView>
  );
}
