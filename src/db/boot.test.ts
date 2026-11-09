import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Contrato de sembrado unificado (B1/R3): el bundle y la app hablan el
 * mismo idioma de claves. Tests estáticos a propósito: `sqlite-store.ts`
 * importa módulos nativos y no se puede cargar en Node.
 */
describe("contrato de bundle unificado (B1)", () => {
  it("sqlite-store declara SCHEMA_VERSION 4 con media_manifest aditiva", () => {
    const src = read("src/db/sqlite-store.ts");
    expect(src).toContain('SCHEMA_VERSION = "4"');
    expect(src).toContain("CREATE TABLE IF NOT EXISTS media_manifest");
    // Migración sin pérdida: open() no borra datos de usuario.
    const openBody = src.slice(src.indexOf("static async open"), src.indexOf("async upsertWords"));
    for (const table of ["words", "courses", "history", "course_progress", "outbox", "kv"]) {
      expect(openBody).not.toMatch(new RegExp(`DELETE FROM ${table}`));
    }
  });

  it("export-db.py siembra claves con prefijo + contentVersion + schema 4", () => {
    const py = read("scripts/export-db.py");
    expect(py).toContain('"piiyaak:lastSync"');
    expect(py).toContain('"piiyaak:contentVersion"');
    expect(py).toContain('"/api/sync/version"');
    expect(py).toContain('("schemaVersion", "4")');
    // Sin la clave heredada sin prefijo:
    expect(py).not.toContain('("lastSync", server_time)');
    expect(py).not.toContain('("schemaVersion", "3")');
  });
});
