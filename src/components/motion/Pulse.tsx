/**
 * Pulso de escala para feedback: 1→1.08→1 sobre motion.fast cuando trigger es true.
 * Respeta reduced motion (sin cambio de escala).
 */
import { useEffect, type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { motion } from "../../theme";

export interface PulseProps {
  children: ReactNode;
  trigger: boolean;
  style?: StyleProp<ViewStyle>;
}

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function Pulse({ children, trigger, style }: PulseProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      scale.value = 1;
      return;
    }
    if (trigger) {
      const half = Math.round(motion.fast / 2);
      scale.value = withSequence(
        withTiming(1.08, { duration: half, easing: EASE }),
        withTiming(1, { duration: half, easing: EASE }),
      );
    } else {
      scale.value = withTiming(1, { duration: Math.round(motion.fast / 2), easing: EASE });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}