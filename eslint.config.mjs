// Fase D W4.4 — eslint mínimo: preset Expo (SDK 52) vía compat, sin reglas
// custom. Alcance solo archivos de Fase D, fijado en el script `lint` de
// package.json; el resto del repo queda fuera del gate (deuda explícita).
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("expo"),
  { ignores: ["dist/*", "node_modules/*"] },
];
