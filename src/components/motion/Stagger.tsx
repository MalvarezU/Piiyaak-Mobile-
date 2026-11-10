/**
 * Entrada escalonada: envuelve cada hijo en un Reveal con delay incremental.
 * Respeta reduced motion vía Reveal.
 */
import React, { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Reveal } from "./Reveal";

export interface StaggerProps {
  children: ReactNode;
  staggerMs?: number;
  style?: StyleProp<ViewStyle>;
}

export function Stagger({ children, staggerMs = 60, style }: StaggerProps) {
  const items = React.Children.toArray(children);
  return (
    <View style={style}>
      {items.map((child, index) => (
        <Reveal key={index} delay={index * staggerMs}>
          {child}
        </Reveal>
      ))}
    </View>
  );
}