import { createElement, Fragment } from "react";
import { screen } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

/**
 * Utilidades compartidas por los tests de pantalla (Jest + jest-expo).
 */

/**
 * Mock de `lucide-react-native`.
 *
 * El paquete se resuelve con la condición de exportación `react-native`, que
 * apunta a un build ESM (`.mjs`). `jest-expo` no transforma ese paquete (no
 * está en su `transformIgnorePatterns`), así que sin este mock cualquier
 * pantalla con íconos revienta con `SyntaxError: Unexpected token 'export'`.
 *
 * El mock expone un ícono inerte para cualquier export del paquete: los
 * tests de UI no afirman sobre la forma del ícono, sino sobre el texto y el
 * comportamiento de la pantalla.
 *
 * Uso (en cada test de pantalla):
 *
 * ```tsx
 * import { mockLucide } from "../../__tests__/_test-utils";
 * jest.mock("lucide-react-native", () => mockLucide);
 * ```
 */

/** Ícono inerte con el mismo contrato que un ícono de lucide. */
const Icon = () => createElement(Fragment, null);

/** Módulo fake de lucide: cualquier ícono resuelve al mismo stub. */
export const mockLucide: Record<string, unknown> = new Proxy<Record<string, unknown>>(
  { __esModule: true },
  {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      return prop in target ? target[prop] : Icon;
    },
  }
);

/**
 * Mock de `react-native-reanimated` para los tests de pantalla.
 *
 * El mock global de `jest.setup.tsx` delega en `react-native-reanimated/mock`,
 * que a su vez carga `react-native-worklets`: su parte nativa no existe en
 * Node y el require revienta con `WorkletsError`. Este mock expone solo la
 * API que usa el kit de motion (`src/components/motion`), sin worklets y con
 * el movimiento reducido activo (el contenido queda visible de entrada).
 */
const AnimatedView = (props: { children?: ReactNode; style?: unknown }) =>
  createElement(View, { style: props.style as StyleProp<ViewStyle> }, props.children);

export const mockReanimated: Record<string, unknown> = {
  __esModule: true,
  default: {
    View: AnimatedView,
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: {
    bezier: () => (t: number) => t,
    linear: (t: number) => t,
    in: (fn: (t: number) => number) => fn,
    out: (fn: (t: number) => number) => fn,
  },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => true,
  useSharedValue: (value: number) => ({ value }),
  withDelay: (_delay: number, value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  cancelAnimation: () => undefined,
  runOnJS: (fn: unknown) => fn,
};

interface RenderedNode {
  props?: { style?: unknown };
  children?: RenderedNode[] | null;
}

/**
 * Styles aplanados de todos los nodos host del árbol renderizado.
 *
 * Sirve para afirmar invariantes de layout que no tienen `testID`
 * (alturas reservadas, grillas, anchos de columna).
 */
export function renderedStyles(): ViewStyle[] {
  const out: ViewStyle[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as RenderedNode;
    const style = n.props?.style;
    if (style) out.push(StyleSheet.flatten(style as StyleProp<ViewStyle>));
    if (n.children) walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}

/**
 * Textos planos renderizados (los fragmentos string de los `Text`).
 *
 * Permite buscar textos sin `testID` cuando el valor depende de la
 * producción (por ejemplo, la pista de una palabra).
 */
export function renderedTexts(): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (typeof item === "string") out.push(item);
        else walk(item);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    const n = node as RenderedNode;
    if (n.children) walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}
