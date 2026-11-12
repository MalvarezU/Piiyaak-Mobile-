import { describe, it, expect, afterEach } from "vitest";
import { openNodeSqlite, type NodeSqliteHandle } from "./node-sqlite-shim";

/**
 * Contrato del shim `node:sqlite` → interfaz `expo-sqlite`.
 *
 * Si este test falla, el resto de los tests de SQL real no significan nada:
 * es la garantía de que el adapter ejecuta SQL de verdad (no un stub).
 */
describe("node-sqlite shim", () => {
  let handle: NodeSqliteHandle | null = null;

  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("ejecuta schema multi-statement con execAsync", async () => {
    handle = openNodeSqlite();
    await handle.db.execAsync(`
      CREATE TABLE words (id TEXT PRIMARY KEY, spanish TEXT NOT NULL);
      CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);
    `);

    const tables = await handle.db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((t) => t.name)).toEqual(["kv", "words"]);
  });

  it("inserta y lee filas con parámetros posicionales", async () => {
    handle = openNodeSqlite();
    await handle.db.execAsync("CREATE TABLE words (id TEXT PRIMARY KEY, spanish TEXT NOT NULL)");

    const inserted = await handle.db.runAsync(
      "INSERT INTO words (id, spanish) VALUES (?, ?)",
      ["w1", "casa"]
    );
    expect(inserted.changes).toBe(1);

    const rows = await handle.db.getAllAsync<{ id: string; spanish: string }>(
      "SELECT id, spanish FROM words WHERE spanish = ?",
      ["casa"]
    );
    expect(rows).toEqual([{ id: "w1", spanish: "casa" }]);
  });

  it("getFirstAsync devuelve null cuando no hay fila", async () => {
    handle = openNodeSqlite();
    await handle.db.execAsync("CREATE TABLE words (id TEXT PRIMARY KEY)");

    const row = await handle.db.getFirstAsync<{ id: string }>(
      "SELECT id FROM words WHERE id = ?",
      ["nope"]
    );
    expect(row).toBeNull();
  });

  it("soporta transacciones con BEGIN IMMEDIATE / COMMIT / ROLLBACK", async () => {
    handle = openNodeSqlite();
    await handle.db.execAsync("CREATE TABLE words (id TEXT PRIMARY KEY)");

    await handle.db.execAsync("BEGIN IMMEDIATE");
    await handle.db.runAsync("INSERT INTO words (id) VALUES (?)", ["w1"]);
    await handle.db.execAsync("COMMIT");

    await handle.db.execAsync("BEGIN IMMEDIATE");
    await handle.db.runAsync("INSERT INTO words (id) VALUES (?)", ["w2"]);
    await handle.db.execAsync("ROLLBACK");

    const rows = await handle.db.getAllAsync<{ id: string }>("SELECT id FROM words");
    expect(rows.map((r) => r.id)).toEqual(["w1"]);
  });

  it("falla con error de SQLite cuando el SQL es inválido", async () => {
    handle = openNodeSqlite();
    await expect(handle.db.execAsync("SELECT * FROM tabla_inexistente")).rejects.toThrow();
  });
});
