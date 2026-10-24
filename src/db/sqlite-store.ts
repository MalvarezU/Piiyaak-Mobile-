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
  illustrationUrl TEXT,
  culturalContext TEXT,
  category TEXT,
  examples TEXT,
  status TEXT,
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
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  syncedAt TEXT
);
CREATE TABLE IF NOT EXISTS history (
  wordId TEXT PRIMARY KEY,
  viewedAt TEXT NOT NULL
);
`;

export interface OutboxRow {
  id: number;
  entity: string;
  op: string;
  payload: string;
  createdAt: string;
  syncedAt: string | null;
}

export interface WordStore {
  upsertWords(rows: WordRow[]): Promise<void>;
  removeWords(ids: string[]): Promise<void>;
  search(query: string, limit?: number): Promise<WordRow[]>;
  listAZ(category?: string | null, limit?: number, offset?: number): Promise<WordRow[]>;
  listCategories(): Promise<string[]>;
  getById(id: string): Promise<WordRow | null>;
  count(): Promise<number>;
  getLastSync(): Promise<string | null>;
  setLastSync(iso: string): Promise<void>;
  getKV(key: string): Promise<string | null>;
  setKV(key: string, value: string): Promise<void>;
  addOutbox(entity: string, op: string, payload: string): Promise<void>;
  pendingOutbox(): Promise<OutboxRow[]>;
  markOutboxSynced(id: number): Promise<void>;
  addHistory(wordId: string, viewedAt: string): Promise<void>;
  listHistory(limit?: number): Promise<string[]>;
  clearHistory(): Promise<void>;
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
const SCHEMA_VERSION = "3";

export class SQLiteWordStore implements WordStore {
  constructor(private db: SQLiteDatabase) {}

  static async open(db: SQLiteDatabase): Promise<SQLiteWordStore> {
    await db.execAsync(SCHEMA);
    // Migración aditiva: columnas nuevas si faltan.
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(words)");
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("illustrationUrl")) {
      await db.execAsync("ALTER TABLE words ADD COLUMN illustrationUrl TEXT");
    }
    if (!names.has("status")) {
      await db.execAsync("ALTER TABLE words ADD COLUMN status TEXT");
    }
    // Versionado del esquema en kv.
    await db.runAsync(
      "INSERT INTO kv (key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [SCHEMA_VERSION]
    );
    return new SQLiteWordStore(db);
  }

  async upsertWords(rows: WordRow[]): Promise<void> {
    if (rows.length === 0) return;
    const placeholders = rows.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    const params = rows.flatMap((w) => [
      w.id,
      w.spanish,
      w.nasaYuwe,
      w.pronunciation,
      w.audioUrl,
      w.illustrationUrl,
      w.culturalContext,
      w.category,
      w.examples,
      w.updatedAt,
      normalize(w.spanish),
      normalize(w.nasaYuwe),
    ]);
    await this.db.runAsync(
      `INSERT INTO words (id, spanish, nasaYuwe, pronunciation, audioUrl, illustrationUrl, culturalContext, category, examples, updatedAt, spanish_norm, nasaYuwe_norm)
       VALUES ${placeholders}
       ON CONFLICT(id) DO UPDATE SET
         spanish=excluded.spanish, nasaYuwe=excluded.nasaYuwe,
         pronunciation=excluded.pronunciation, audioUrl=excluded.audioUrl,
         illustrationUrl=excluded.illustrationUrl,
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
       WHERE (spanish_norm LIKE '%' || ? || '%' OR nasaYuwe_norm LIKE '%' || ? || '%')
         AND (status IS NULL OR status != 'DRAFT')
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
        "SELECT * FROM words WHERE category = ? AND (status IS NULL OR status != 'DRAFT') ORDER BY spanish LIMIT ? OFFSET ?",
        [category, limit, offset]
      );
    }
    return this.db.getAllAsync<WordRow>(
      "SELECT * FROM words WHERE (status IS NULL OR status != 'DRAFT') ORDER BY spanish LIMIT ? OFFSET ?",
      [limit, offset]
    );
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ category: string }>(
      "SELECT DISTINCT category FROM words WHERE category IS NOT NULL AND category != '' AND (status IS NULL OR status != 'DRAFT') ORDER BY category"
    );
    return rows.map((r) => r.category);
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

  async getKV(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM kv WHERE key = ?",
      [key]
    );
    return row?.value ?? null;
  }

  async setKV(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, value]
    );
  }

  async addOutbox(entity: string, op: string, payload: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO outbox (entity, op, payload, createdAt) VALUES (?,?,?,?)",
      [entity, op, payload, new Date().toISOString()]
    );
  }

  async pendingOutbox(): Promise<OutboxRow[]> {
    return this.db.getAllAsync<OutboxRow>(
      "SELECT id, entity, op, payload, createdAt, syncedAt FROM outbox WHERE syncedAt IS NULL ORDER BY id ASC"
    );
  }

  async markOutboxSynced(id: number): Promise<void> {
    await this.db.runAsync(
      "UPDATE outbox SET syncedAt = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
  }

  async addHistory(wordId: string, viewedAt: string): Promise<void> {
    await this.db.runAsync(
      "INSERT INTO history (wordId, viewedAt) VALUES (?, ?) ON CONFLICT(wordId) DO UPDATE SET viewedAt=excluded.viewedAt",
      [wordId, viewedAt]
    );
  }

  async listHistory(limit = 50): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ wordId: string }>(
      "SELECT wordId FROM history ORDER BY viewedAt DESC LIMIT ?",
      [limit]
    );
    return rows.map((r) => r.wordId);
  }

  async clearHistory(): Promise<void> {
    await this.db.runAsync("DELETE FROM history");
  }
}
