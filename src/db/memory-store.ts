import type { WordRow } from "./types";
import type { WordStore } from "./sqlite-store";
import { normalize } from "../normalize";

/**
 * Implementación en memoria de WordStore: misma semántica que SQLite
 * para correr la lógica (sync, búsqueda) en tests Node.
 */
export class MemoryWordStore implements WordStore {
  private words = new Map<string, WordRow>();
  private kv = new Map<string, string>();
  /** Misma clave unificada que SQLiteWordStore (`piiyaak:lastSync`). */
  private static readonly LAST_SYNC_KEY = "piiyaak:lastSync";

  async upsertWords(rows: WordRow[]): Promise<void> {
    for (const w of rows) this.words.set(w.id, { ...w });
  }

  async removeWords(ids: string[]): Promise<void> {
    for (const id of ids) this.words.delete(id);
  }

  async search(query: string, limit = 20): Promise<WordRow[]> {
    const q = normalize(query);
    if (q.length < 2) return [];
    const all = [...this.words.values()].filter((w) => w.status !== 'DRAFT');
    const rank = (w: WordRow): number => {
      const es = normalize(w.spanish);
      const ny = normalize(w.nasaYuwe);
      if (es === q || ny === q) return 0;
      if (es.startsWith(q) || ny.startsWith(q)) return 1;
      if (es.includes(q) || ny.includes(q)) return 2;
      return 3;
    };
    return all
      .filter((w) => rank(w) < 3)
      .sort((a, b) => rank(a) - rank(b) || a.spanish.localeCompare(b.spanish, "es"))
      .slice(0, limit);
  }

  async listAZ(category: string | null = null, limit = 50, offset = 0): Promise<WordRow[]> {
    const all = [...this.words.values()]
      .filter((w) => w.status !== 'DRAFT')
      .filter((w) => !category || w.category === category)
      .sort((a, b) => a.spanish.localeCompare(b.spanish, "es"));
    return all.slice(offset, offset + limit);
  }

  async listCategories(): Promise<string[]> {
    const set = new Set<string>();
    for (const w of this.words.values()) {
      if (w.status !== 'DRAFT' && w.category) set.add(w.category);
    }
    return [...set].sort();
  }

  async getById(id: string): Promise<WordRow | null> {
    return this.words.get(id) ?? null;
  }

  async count(): Promise<number> {
    return this.words.size;
  }

  async getLastSync(): Promise<string | null> {
    return this.kv.get(MemoryWordStore.LAST_SYNC_KEY) ?? null;
  }

  async setLastSync(iso: string): Promise<void> {
    this.kv.set(MemoryWordStore.LAST_SYNC_KEY, iso);
  }

  async getKV(key: string): Promise<string | null> {
    return this.kv.get(key) ?? null;
  }

  async setKV(key: string, value: string): Promise<void> {
    this.kv.set(key, value);
  }

  private outbox: { id: number; entity: string; op: string; payload: string; createdAt: string; syncedAt: string | null }[] = [];
  private history = new Map<string, string>();
  private nextOutboxId = 1;

  async addOutbox(entity: string, op: string, payload: string): Promise<void> {
    this.outbox.push({ id: this.nextOutboxId++, entity, op, payload, createdAt: new Date().toISOString(), syncedAt: null });
  }

  async pendingOutbox() {
    return this.outbox.filter((r) => r.syncedAt === null);
  }

  async markOutboxSynced(id: number): Promise<void> {
    const r = this.outbox.find((x) => x.id === id);
    if (r) r.syncedAt = new Date().toISOString();
  }

  async addHistory(wordId: string, viewedAt: string): Promise<void> {
    this.history.set(wordId, viewedAt);
  }

  async listHistory(limit = 50): Promise<string[]> {
    return [...this.history.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, limit)
      .map(([id]) => id);
  }

  async clearHistory(): Promise<void> {
    this.history.clear();
  }
}
