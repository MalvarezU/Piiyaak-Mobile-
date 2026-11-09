import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * W3-03 — contrato estático del componente `SeedProgress` (spec §4.2).
 * El entorno vitest es node sin render RN (precedente: `boot.test.ts`);
 * la lógica se testea en `seed-machine.test.ts`. Acá: accesibilidad,
 * objetivos táctiles, copy neutral y enganche en `index.tsx`.
 */
describe("SeedProgress (contrato estático)", () => {
  const cmp = () => src("src/components/seed-progress.tsx");

  it("expone progressbar con valores y alert en error", () => {
    expect(cmp()).toContain('accessibilityRole="progressbar"');
    expect(cmp()).toContain('accessibilityRole="alert"');
    expect(cmp()).toContain("accessibilityValue");
  });

  it("usa objetivos táctiles >= 44pt y botones con el copy exigido", () => {
    expect(cmp()).toContain("minHeight: 44");
    expect(cmp()).toContain("Reintentar");
    expect(cmp()).toContain("Continuar solo con texto");
  });

  it("delega el copy neutral a la máquina (sin strings duplicados ni hype)", () => {
    expect(cmp()).toContain("seedStatusCopy");
    expect(cmp()).toContain("seed-machine");
    const machine = src("src/db/seed-machine.ts");
    for (const line of [
      "Comprobando versión del contenido…",
      "Descargando contenido…",
      "Verificando contenido…",
      "Instalando contenido…",
    ]) {
      expect(machine).toContain(line);
    }
    // Sin eyebrow ALL-CAPS ni adornos sobre cada heading.
    expect(cmp()).not.toMatch(/🚀|✨|🎉|🔥/);
    expect(machine).not.toMatch(/🚀|✨|🎉|🔥/);
  });

  it("index.tsx reemplaza el texto estático por la máquina de estados", () => {
    const index = src("src/app/index.tsx");
    expect(index).toContain("SeedProgress");
    expect(index).toContain("seedState");
  });
});
