import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * T-W2.3 — contrato estático del componente `UpdateNotice` (spec §W2.5,
 * caso §W2.6 6). El entorno vitest es node sin render RN (precedente:
 * `seed-progress.test.ts`); los textos exactos, roles y objetivos
 * táctiles se fijan por contrato y la pantalla sigue operable porque
 * el aviso convive con el contenido (contrato sobre `index.tsx`).
 */
describe("UpdateNotice (contrato estático)", () => {
  const cmp = () => src("src/components/update-notice.tsx");

  it("anuncia con rol alert y el título exacto", () => {
    expect(cmp()).toContain('accessibilityRole="alert"');
    expect(cmp()).toContain("Hay contenido nuevo disponible");
  });

  it("muestra versión + tamaño + archivos cuando hay metadatos", () => {
    // Formato: `Versión <remote> · <X MB> · <N archivos>` (MB con un
    // decimal, como `formatSeedProgress`).
    expect(cmp()).toContain("Versión");
    expect(cmp()).toContain("MB");
    expect(cmp()).toContain("archivos");
  });

  it("sin metadatos muestra solo la versión", () => {
    expect(cmp()).toContain("bytesTotal");
    expect(cmp()).toContain("files");
  });

  it("ofrece Descargar ahora / Más tarde con objetivos >= 44pt", () => {
    expect(cmp()).toContain("Descargar ahora");
    expect(cmp()).toContain("Más tarde");
    expect(cmp()).toContain("minHeight: 44");
    expect(cmp()).toContain("onDownload");
    expect(cmp()).toContain("onLater");
  });

  it("reutiliza el lenguaje visual de SeedProgress sin duplicar hype", () => {
    expect(cmp()).toContain("theme.card");
    expect(cmp()).not.toMatch(/🚀|✨|🎉|🔥/);
  });

  it("index.tsx muestra el aviso junto al contenido operable (no bloqueante)", () => {
    const index = src("src/app/index.tsx");
    expect(index).toContain("UpdateNotice");
    expect(index).toContain("updateAvailable");
    expect(index).toContain("acceptUpdate");
    expect(index).toContain("dismissUpdate");
    // El diccionario sigue ahí con el aviso visible.
    expect(index).toContain("FlatList");
    expect(index).toContain("SeedProgress");
  });
});
