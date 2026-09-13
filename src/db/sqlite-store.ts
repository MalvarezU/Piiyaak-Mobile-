import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SQLiteDatabase } from "expo-sqlite";
import { normalize } from "../normalize";
import type { WordRow } from "./types";

/**
 * Capa SQLite local (B3.3): snapshot + deltas del contrato /api/sync.
 * Expo Go / dev-client: `expo-sqlite` provee la BD. La interfaz WordStore
 * permite la implementación en memoria para tests en Node.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  spanish TEXT NOT NULL,
  nasaYuwe TEXT NOT NULL,
  pronunciation TEXT,
  audioUrl TEXT,
  culturalContext TEXT,
  category TEXT,
  examples TEXT,
  updatedAt TEXT NOT NULL,
  spanish_norm TEXT NOT NULL DEFAULT '',
  nasaYuwe_norm TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_words_spanish ON words(spanish_norm);
CREATE INDEX IF NOT EXISTS idx_words_updated ON words(updatedAt);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface WordStore {
  upsertWords(rows: WordRow[]): Promise<void>;
  removeWords(ids: string[]): Promise<void>;
  search(query: string, limit?: number): Promise<WordRow[]>;
  listAZ(category?: string | null, limit?: number, offset?: number): Promise<WordRow[]>;
  getById(id: string): Promise<WordRow | null>;
  count(): Promise<number>;
  getLastSync(): Promise<string | null>;
  setLastSync(iso: string): Promise<void>;
}

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class AsyncStorageKV implements KeyValue {
  async get(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }
}

const LAST_SYNC_KEY = "piiyaak:lastSync";

export class SQLiteWordStore implements WordStore {
  constructor(private db: SQLiteDatabase) {}

  static async open(db: SQLiteDatabase): Promise<SQLiteWordStore> {
    await db.execAsync(SCHEMA);
    return new SQLiteWordStore(db);
  }

  async upsertWords(rows: WordRow[]): Promise<void> {
    if (rows.length === 0) return;
    const placeholders = rows.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params = rows.flatMap((w) => [
      w.id,
      w.spanish,
      w.nasaYuwe,
      w.pronunciation,
      w.audioUrl,
      w.culturalContext,
      w.category,
      w.examples,
      w.updatedAt,
      normalize(w.spanish),
      normalize(w.nasaYuwe),
    ]);
    await this.db.runAsync(
      `INSERT INTO words (id, spanish, nasaYuwe, pronunciation, audioUrl, culturalContext, category, examples, updatedAt, spanish_norm, nasaYuwe_norm)
       VALUES ${placeholders}
       ON CONFLICT(id) DO UPDATE SET
         spanish=excluded.spanish, nasaYuwe=excluded.nasaYuwe,
         pronunciation=excluded.pronunciation, audioUrl=excluded.audioUrl,
         culturalContext=excluded.culturalContext, category=excluded.category,
         examples=excluded.examples, updatedAt=excluded.updatedAt,
         spanish_norm=excluded.spanish_norm, nasaYuwe_norm=excluded.nasaYuwe_norm`,
      params
    );
  }

  async removeWords(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.runAsync(
      `DELETE FROM words WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
  }

  async search(query: string, limit = 20): Promise<WordRow[]> {
    const q = normalize(query);
    if (q.length < 2) return [];
    return this.db.getAllAsync<WordRow>(
      `SELECT * FROM words
       WHERE spanish_norm LIKE '%' || ? || '%' OR nasaYuwe_norm LIKE '%' || ? || '%'
       ORDER BY CASE WHEN spanish_norm = ? OR nasaYuwe_norm = ? THEN 0
                     WHEN spanish_norm LIKE ? || '%' OR nasaYuwe_norm LIKE ? || '%' THEN 1
                     ELSE 2 END, spanish
       LIMIT ?`,
      [q, q, q, q, q, q, limit]
    );
  }

  async listAZ(category: string | null = null, limit = 50, offset = 0): Promise<WordRow[]> {
    if (category) {
      return this.db.getAllAsync<WordRow>(
        "SELECT * FROM words WHERE category = ? ORDER BY spanish LIMIT ? OFFSET ?",
        [category, limit, offset]
      );
    }
    return this.db.getAllAsync<WordRow>("SELECT * FROM words ORDER BY spanish LIMIT ? OFFSET ?", [
      limit,
      offset,
    ]);
  }

  async getById(id: string): Promise<WordRow | null> {
    return this.db.getFirstAsync<WordRow>("SELECT * FROM words WHERE id = ?", [id]);
  }

  async count(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM words"
    );
    return row?.n ?? 0;
  }

  async getLastSync(): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key = ?",
      [LAST_SYNC_KEY]
    );
    return row?.value ?? null;
  }

  async setLastSync(iso: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [LAST_SYNC_KEY, iso]
    );
  }
}
