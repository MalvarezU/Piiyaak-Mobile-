/**
 * Configuración de Jest para los tests de UI/React Native.
 *
 * Separación de runners (deliberada):
 * - archivos `.test.ts`  → Vitest (lógica pura de Node: db, seed, sync, api).
 * - archivos `.test.tsx` → Jest + jest-expo (componentes/pantallas React Native).
 *
 * Motivo: `react-native` se distribuye como CommonJS con tipos Flow y
 * `require()` anidados; el pipeline de Vite/Vitest no puede transformar esos
 * requires (los carga Node nativo y rompe el parseo de Flow). Jest usa
 * babel-jest por archivo, que sí resuelve esto vía `babel-preset-expo`.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: "jest-expo/ios",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.tsx"],
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/android/"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/test/**",
    "!src/bench-search.ts",
    "!src/bundled-media.generated.ts",
    "!src/db/__mocks__/**",
  ],
};
