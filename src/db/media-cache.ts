/**
 * Media-cache por contenido (B3). Esqueleto de tipos (B3-01);
 * implementación en B3-02 (clave + manifiesto) y B3-03 (poda + lookup).
 *
 * Módulo puro: no importa `expo-file-system` (frontera nativa aislada en
 * `MediaStore`, implementada por `src/db/media-fs.ts` en la app y por
 * `createMemoryMediaStore` / el mock `__mocks__/expo-file-system` en tests).
 */
import type { WordRow } from "./types";

export type MediaKind = "audio" | "illustration";

export interface MediaRef {
  wordId: string;
  kind: MediaKind;
  url: string;
  /** `null` = fallback por URL normalizada (modo F1-b transitorio). */
  sha256: string | null;
}

export interface MediaManifestRow {
  wordId: string;
  kind: MediaKind;
  url: string;
  sha256: string | null;
  localUri: string;
}

/** Frontera nativa testeable (responde a R1 y R6). */
export interface MediaStore {
  getInfo(uri: string): Promise<{ exists: boolean }>;
  makeDir(uri: string): Promise<void>;
  download(url: string, destUri: string): Promise<{ uri: string }>;
  remove(uri: string): Promise<void>;
  listDir(dirUri: string): Promise<string[]>;
  /** Necesaria para la migración perezosa del doble lookup (B3-03). */
  copy(fromUri: string, toUri: string): Promise<void>;
}

export interface MediaCache {
  localUriFor(ref: MediaRef): string;
  ensureCached(ref: MediaRef): Promise<string>;
  exists(ref: MediaRef): Promise<boolean>;
  prune(
    manifest: readonly MediaManifestRow[],
    favorites?: readonly string[]
  ): Promise<{ removed: number }>;
  buildManifest(
    words: readonly WordRow[],
    extra: readonly MediaRef[]
  ): Promise<MediaManifestRow[]>;
}
