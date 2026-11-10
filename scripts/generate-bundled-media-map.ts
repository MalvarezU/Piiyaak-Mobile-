/**
 * Genera src/bundled-media.generated.ts a partir de los archivos reales en
 * assets/audios/ y assets/illustrations/.
 *
 * Uso: npx tsx scripts/generate-bundled-media-map.ts
 *
 * El workflow de la APK lo corre DESPUÉS de descargar los medios del seed
 * desde R2, de modo que el mapa siempre refleja el contenido embebido real.
 * En local se corre a mano tras agregar/quitar assets.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const DIRS: Array<{ dir: string; varName: string }> = [
  { dir: "assets/audios", varName: "BUNDLED_AUDIOS" },
  { dir: "assets/illustrations", varName: "BUNDLED_ILLUSTRATIONS" },
];

const lines: string[] = [
  "/**",
  " * Mapa generado — NO EDITAR A MANO.",
  " * Generado por scripts/generate-bundled-media-map.ts desde los archivos",
  " * reales en assets/. Clave = ruta relativa del asset.",
  " */",
];

for (const { dir, varName } of DIRS) {
  const files = readdirSync(join(ROOT, dir)).filter((f) => !f.startsWith("."));
  lines.push(`export const ${varName}: Record<string, number> = {};`);
  lines.push("try {");
  // Clave = ruta relativa a assets/ (formato que guarda la DB: audios/X, illustrations/Y).
  const prefix = dir.replace(/^assets\//, "");
  for (const f of files.sort()) {
    const key = `${prefix}/${f}`;
    lines.push(`  // eslint-disable-next-line @typescript-eslint/no-require-imports`);
    lines.push(`  ${varName}["${key}"] = require("../${dir}/${f}");`);
  }
  lines.push("} catch {");
  lines.push("  // Entorno de test (vitest/ESM): require() no disponible.");
  lines.push("}");
  lines.push("");
}

writeFileSync(join(ROOT, "src", "bundled-media.generated.ts"), lines.join("\n"));
console.log(`mapa generado: ${DIRS.map((d) => d.dir).join(", ")}`);
