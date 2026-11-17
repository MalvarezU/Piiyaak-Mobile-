/**
 * Raíz de pantalla: fondo crema del token y áreas seguras resueltas por
 * react-native-safe-area-context. NO aplica padding horizontal: cada
 * pantalla decide su ritmo de bordes (aquí solo superficie y engranaje
 * con el chrome de navegación).
 *
 * Con `background`: foto a cover (testID screen-background) + 3 overlays
 * no interactivos encima, en este orden: tinte territorio 0.06
 * (screen-tint), scrim montanaDeep 0.10 (screen-scrim) y banda alta
 * montanaDeep 0.05 en el 35% superior (screen-topband). El contenido va
 * encima en un SafeAreaView transparente; la base es montanaDeep
 * (anti-flash mientras carga la foto). Sin background: crema intacta.
 * Opacidades más claras que la versión anterior (0.06/0.10/0.05).
 * Estilos solo con tokens de src/theme.ts.
 */
import { Image, StyleSheet, View } from "react-native";
import type { ImageSourcePropType, StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ReactNode } from "react";
import { theme } from "../../theme";

export interface ScreenBackground {
  source: ImageSourcePropType;
}

export interface ScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  background?: ScreenBackground;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.background,
  },
  photoRoot: {
    flex: 1,
    backgroundColor: theme.montanaDeep,
  },
  tint: {
    backgroundColor: theme.territorio,
    opacity: 0.06,
  },
  scrim: {
    backgroundColor: theme.montanaDeep,
    opacity: 0.1,
  },
  topband: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "35%",
    backgroundColor: theme.montanaDeep,
    opacity: 0.05,
  },
  photoContent: {
    flex: 1,
    backgroundColor: "transparent",
  },
});

export function Screen({ children, style, background }: ScreenProps) {
  if (!background) {
    return (
      <SafeAreaView style={[styles.root, style]} edges={["top", "bottom"]}>
        {children}
      </SafeAreaView>
    );
  }
  return (
    <View style={styles.photoRoot}>
      <Image
        testID="screen-background"
        source={background.source}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <View
        testID="screen-tint"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.tint]}
      />
      <View
        testID="screen-scrim"
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.scrim]}
      />
      <View testID="screen-topband" pointerEvents="none" style={styles.topband} />
      <SafeAreaView style={[styles.photoContent, style]} edges={["top", "bottom"]}>
        {children}
      </SafeAreaView>
    </View>
  );
}
