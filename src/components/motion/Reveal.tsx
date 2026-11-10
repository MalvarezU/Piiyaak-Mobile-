/**
 * Entrada de elemento: opacity 0→1 + translateY 12→0 sobre motion.base.
 * Corre una sola vez al montar. Respeta reduced motion (muestra de inmediato).
 */
import { useEffect, type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { motion } from "../../theme";

export interface RevealProps {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function Reveal({ children, delay = 0, style }: RevealProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const translateY = useSharedValue(reduced ? 0 : 12);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: motion.base, easing: EASE }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: motion.base, easing: EASE }),
    );
    // Solo montaje: no re-ejecutar si cambian props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}