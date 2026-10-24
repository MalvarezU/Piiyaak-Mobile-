/** Fila de palabra tal como la entrega /api/sync (B3.1). */
export interface WordRow {
  id: string;
  spanish: string;
  nasaYuwe: string;
  pronunciation: string | null;
  audioUrl: string | null;
  illustrationUrl: string | null;
  culturalContext: string | null;
  category: string | null;
  examples: string | null;
  status?: string;
  updatedAt: string;
}

export interface SyncResult {
  applied: number;
  removed: number;
  serverTime: string | null;
  hasMore: boolean;
}
