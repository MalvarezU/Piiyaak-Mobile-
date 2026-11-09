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
  /**
   * Hashes F1-a (mini-change backend): digest SHA-256 hex de los bytes del
   * medio. `null`/ausente = fallback por URL normalizada (F1-b).
   * Columnas opcionales: el manifiesto (`media_manifest`) es la fuente
   * de verdad del caché (spec §2.2); SQLite no las exige.
   */
  audioSha256?: string | null;
  illustrationSha256?: string | null;
}

export interface SyncResult {
  applied: number;
  removed: number;
  serverTime: string | null;
  hasMore: boolean;
}
