import type { WordRow } from "./types";
import type { WordStore } from "./sqlite-store";
import { normalize } from "../normalize";

/**
 * Implementación en memoria de WordStore: misma semántica que SQLite
 * para correr la lógica (sync, búsqueda) en tests Node.
 */
export class MemoryWordStore implements WordStore {
  private words = new Map<string, WordRow>();
  private lastSync: string | null = null;

  async upsertWords(rows: WordRow[]): Promise<void> {
    for (const w of rows) this.words.set(w.id, { ...w });
  }

  async removeWords(ids: string[]): Promise<void> {
    for (const id of ids) this.words.delete(id);
  }

  async search(query: string, limit = 20): Promise<WordRow[]> {
    const q = normalize(query);
    if (q.length < 2) return [];
    const all = [...this.words.values()];
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
      .filter((w) => !category || w.category === category)
      .sort((a, b) => a.spanish.localeCompare(b.spanish, "es"));
    return all.slice(offset, offset + limit);
  }

  async getById(id: string): Promise<WordRow | null> {
    return this.words.get(id) ?? null;
  }

  async count(): Promise<number> {
    return this.words.size;
  }

  async getLastSync(): Promise<string | null> {
    return this.lastSync;
  }

  async setLastSync(iso: string): Promise<void> {
    this.lastSync = iso;
  }
}
