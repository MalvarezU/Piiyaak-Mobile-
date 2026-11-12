import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

/**
 * Adapter de `node:sqlite` (Node >= 22.5, ya estable en Node 24) con la misma
 * interfaz async que usa `expo-sqlite`.
 *
 * Por qué existe: el SQL de producción (`src/db/sqlite-store.ts` y
 * `src/db/course-store.ts`) nunca se ejecutaba contra SQLite real en los
 * tests — solo contra stubs que no validan sintaxis, constraints ni
 * migraciones. Con este shim, los tests corren el SQL exacto contra una base
 * en memoria, sin depender de un emulador.
 *
 * La interfaz que consumen los stores es mínima y estable:
 * `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`.
 */

export interface NodeSqliteHandle {
  /** Instancia con la interfaz de `expo-sqlite` (listo para los stores). */
  db: SQLiteDatabase;
  /** Acceso a la base cruda (diagnóstico / aserciones directas). */
  raw: DatabaseSync;
  close: () => void;
}

/**
 * Abre una base SQLite (`:memory:` por defecto) y la expone con la interfaz
 * async de `expo-sqlite`.
 */
export function openNodeSqlite(path = ":memory:"): NodeSqliteHandle {
  const raw = new DatabaseSync(path);

  const api = {
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },

    async runAsync(
      sql: string,
      params?: readonly SQLInputValue[]
    ): Promise<{ lastInsertRowId: number; changes: number }> {
      const result = raw.prepare(sql).run(...(params ?? []));
      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },

    async getAllAsync<T>(sql: string, params?: readonly SQLInputValue[]): Promise<T[]> {
      const rows = raw.prepare(sql).all(...(params ?? []));
      // `node:sqlite` devuelve objetos sin prototype: se copian a objetos
      // planos para que `toEqual`/`toMatchObject` se comporten como espera.
      return rows.map((row) => ({ ...row })) as T[];
    },

    async getFirstAsync<T>(sql: string, params?: readonly SQLInputValue[]): Promise<T | null> {
      const row = raw.prepare(sql).get(...(params ?? []));
      return row === undefined ? null : ({ ...row } as T);
    },
  };

  return {
    db: api as unknown as SQLiteDatabase,
    raw,
    close: () => raw.close(),
  };
}
