/**
 * Media-cache por contenido (B3). Clave por `sha256` (F1-a) con fallback
 * por URL normalizada (F1-b transitoria), manifiesto y poblado.
 *
 * Módulo puro: no importa `expo-file-system` (frontera nativa aislada en
 * `MediaStore`, implementada por `src/db/media-fs.ts` en la app y por
 * `createMemoryMediaStore` / el mock `__mocks__/expo-file-system` en tests).
 */
import { z } from "zod";
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
  ensureAllCached(
    refs: readonly MediaRef[]
  ): Promise<{ ok: string[]; failed: MediaRef[] }>;
  prune(
    manifest: readonly MediaManifestRow[],
    favorites?: readonly string[]
  ): Promise<{ removed: number }>;
  buildManifest(
    words: readonly WordRow[],
    extra: readonly MediaRef[]
  ): Promise<MediaManifestRow[]>;
}

/** Persistencia del manifiesto (memoria y SQLite la implementan). */
export interface MediaManifestStore {
  upsertManifest(row: MediaManifestRow): Promise<void>;
  listManifest(): Promise<MediaManifestRow[]>;
  clearManifestStale(
    validKeys: readonly string[],
    favoriteIds: readonly string[]
  ): Promise<{ removed: number }>;
}

export function manifestKey(wordId: string, kind: MediaKind): string {
  return `${wordId}|${kind}`;
}

export class MediaIntegrityError extends Error {
  constructor(public readonly ref: MediaRef) {
    super(`hash mismatch: ${ref.kind} ${ref.wordId}`);
    this.name = "MediaIntegrityError";
  }
}

/** Validación en el borde (spec §3.3): solo `https:`. */
export const MediaUrlSchema = z.string().url().startsWith("https://");

/**
 * `https:` siempre; `http:` solo en desarrollo local
 * (`localhost`/`127.0.0.1`/`0.0.0.0`, spec §3.2). Todo lo demás se rechaza.
 */
export function isAllowedMediaUrl(url: string): boolean {
  if (MediaUrlSchema.safeParse(url).success) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

const HASH64 = /^[0-9a-f]{64}$/i;

function extFromUrl(url: string, fallback: string): string {
  const clean = (url.split("?")[0] ?? "").split("#")[0] ?? "";
  const last = clean.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot > 0 && dot < last.length - 1) {
    const ext = last.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  }
  return fallback;
}

/** URL sin query ni fragmento, no alfanuméricos → `_`, máx. 120 (spec §1.3). */
export function normalizeUrlKey(url: string): string {
  const clean = (url.split("?")[0] ?? "").split("#")[0] ?? url;
  return clean.replace(/[^A-Za-z0-9]/g, "_").slice(0, 120);
}

function fileNameFor(ref: MediaRef): string {
  if (ref.sha256 && HASH64.test(ref.sha256)) {
    const ext = extFromUrl(ref.url, ref.kind === "audio" ? "mp3" : "png");
    return `${ref.sha256.toLowerCase()}.${ext}`;
  }
  return urlCacheFileName(ref.url, ref.kind);
}

/**
 * Nombre de archivo del cache para una URL sin `sha256` conocido (modo
 * F1-b): clave por URL normalizada. Exportado para que el seed-swap
 * mueva los medios del zip con EXACTAMENTE la clave que `localUriFor`
 * consulta — con nombres por contenido el cache nunca los encontraba.
 */
export function urlCacheFileName(url: string, kind: MediaKind): string {
  const ext = extFromUrl(url, kind === "audio" ? "mp3" : "png");
  return `url_${normalizeUrlKey(url)}.${ext}`;
}

export interface MediaCacheOptions {
  /** Directorio base (`documentDirectory` en la app). Siempre explícito. */
  baseDir: string;
  /** Espera entre reintentos (default 1000 ms; inyectable en tests). */
  retryDelayMs?: number;
  /** Intentos totales por descarga (default 3 = 1 + 2 reintentos). */
  maxAttempts?: number;
  /** Descargas simultáneas en `ensureAllCached` (default 4). */
  concurrency?: number;
  /**
   * Verificación post-descarga en modo `sha256` (spec §6.3). Ante
   * `false`: elimina el parcial, reintenta una vez y luego reporta la
   * referencia en `failed` sin bloquear el resto. Default: sin verificación
   * (el digest requiere lectura de bytes, sin lector en la frontera actual;
   * ver riesgos).
   */
  verify?: (ref: MediaRef, localUri: string) => Promise<boolean>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Store en memoria para tests (sin frontera nativa). */
export function createMemoryMediaStore(
  baseDir = "file:///mock-doc/"
): MediaStore & { __files(): Map<string, string> } {
  const files = new Map<string, string>();
  const key = (uri: string): string => uri;
  return {
    __files: () => files,
    async getInfo(uri: string) {
      if (files.has(key(uri))) return { exists: true };
      const prefix = uri.endsWith("/") ? uri : `${uri}/`;
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) return { exists: true };
      }
      return { exists: false };
    },
    async makeDir(_uri: string) {
      // Sin-op en memoria: los archivos viven en el mapa.
    },
    async download(url: string, destUri: string) {
      files.set(key(destUri), `bytes-of:${url}`);
      return { uri: destUri };
    },
    async remove(uri: string) {
      files.delete(key(uri));
    },
    async listDir(dirUri: string) {
      const prefix = dirUri.endsWith("/") ? dirUri : `${dirUri}/`;
      const names: string[] = [];
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest && !rest.includes("/")) names.push(rest);
      }
      return names;
    },
    async copy(fromUri: string, toUri: string) {
      const bytes = files.get(key(fromUri));
      if (bytes === undefined) throw new Error(`not found: ${fromUri}`);
      files.set(key(toUri), bytes);
    },
  };
}

export function createMediaCache(
  store: MediaStore,
  opts: MediaCacheOptions & { sleep?: (ms: number) => Promise<void> }
): MediaCache {
  const base = opts.baseDir;
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const sleep = opts.sleep ?? defaultSleep;
  const audioDir = `${base}audios/`;
  const illustrationDir = `${base}illustrations/`;
  const dirFor = (kind: MediaKind): string =>
    kind === "audio" ? audioDir : illustrationDir;

  const cache: MediaCache = {
    localUriFor(ref: MediaRef): string {
      return `${dirFor(ref.kind)}${fileNameFor(ref)}`;
    },

    async exists(ref: MediaRef): Promise<boolean> {
      return (await store.getInfo(cache.localUriFor(ref))).exists;
    },

    async ensureCached(ref: MediaRef): Promise<string> {
      const dest = cache.localUriFor(ref);
      if ((await store.getInfo(dest)).exists) return dest;
      await store.makeDir(dirFor(ref.kind));
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (attempt > 1) await sleep(retryDelayMs);
        try {
          const dl = await store.download(ref.url, dest);
          if (ref.sha256 && HASH64.test(ref.sha256) && opts.verify) {
            const ok = await opts.verify(ref, dl.uri);
            if (!ok) {
              await store.remove(dl.uri).catch(() => {});
              throw new MediaIntegrityError(ref);
            }
          }
          return dl.uri;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("download failed");
    },

    async ensureAllCached(
      refs: readonly MediaRef[]
    ): Promise<{ ok: string[]; failed: MediaRef[] }> {
      const ok: string[] = [];
      const failed: MediaRef[] = [];
      let next = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, Math.max(refs.length, 1)) },
        async () => {
          while (next < refs.length) {
            const ref = refs[next++]!;
            try {
              ok.push(await cache.ensureCached(ref));
            } catch {
              failed.push(ref);
            }
          }
        }
      );
      await Promise.all(workers);
      return { ok, failed };
    },

    async prune(
      manifest: readonly MediaManifestRow[],
      favorites: readonly string[] = []
    ): Promise<{ removed: number }> {
      // Contrato §6.4: el manifiesto pasado es el persistido
      // (`listManifest`), que `clearManifestStale` mantiene con las filas de
      // favoritas; así los archivos por contenido de favoritas están en `keep`.
      // Segunda capa: el nombre heredado `<wordId>.<ext>` de una favorita
      // nunca se poda aunque su hash haya salido del manifiesto.
      const keep = new Set(manifest.map((r) => r.localUri));
      const favs = new Set(favorites);
      let removed = 0;
      for (const dir of [audioDir, illustrationDir]) {
        let entries: string[];
        try {
          entries = await store.listDir(dir);
        } catch {
          continue;
        }
        for (const entry of entries) {
          const full = entry.startsWith(dir) ? entry : `${dir}${entry}`;
          if (keep.has(full)) continue;
          const baseName = full.slice(dir.length).split("/")[0] ?? "";
          const dot = baseName.lastIndexOf(".");
          const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
          if (favs.has(stem)) continue;
          await store.remove(full);
          removed++;
        }
      }
      return { removed };
    },

    async buildManifest(
      words: readonly WordRow[],
      extra: readonly MediaRef[]
    ): Promise<MediaManifestRow[]> {
      const { refs } = collectMediaRefs(words, extra);
      const seen = new Set<string>();
      const rows: MediaManifestRow[] = [];
      for (const ref of refs) {
        // Dos palabras pueden compartir archivo: la PK del manifiesto es
        // (word_id, kind), así que se deduplica por palabra, no por archivo.
        const dedupeKey = `${ref.wordId}|${ref.kind}|${ref.url}|${ref.sha256}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        rows.push({ ...ref, localUri: cache.localUriFor(ref) });
      }
      return rows;
    },
  };
  return cache;
}

/**
 * Extrae referencias de palabras `PUBLISHED` + `extra` (palabra del día y
 * bloques/covers ya convertidos), validando URLs en el borde. Las inválidas
 * se omiten y se contabilizan en `skipped` (spec §3.3) sin abortar.
 * `buildManifest` conserva la firma normativa y expone el conteo por acá.
 */
export function collectMediaRefs(
  words: readonly WordRow[],
  extra: readonly MediaRef[]
): { refs: MediaRef[]; skipped: number } {
  const refs: MediaRef[] = [];
  let skipped = 0;
  const push = (ref: MediaRef): void => {
    if (typeof ref.url !== "string" || !isAllowedMediaUrl(ref.url)) {
      skipped++;
      return;
    }
    refs.push(ref);
  };
  for (const w of words) {
    if (w.status === "DRAFT") continue;
    if (w.audioUrl) {
      push({
        wordId: w.id,
        kind: "audio",
        url: w.audioUrl,
        sha256: w.audioSha256 ?? null,
      });
    }
    if (w.illustrationUrl) {
      push({
        wordId: w.id,
        kind: "illustration",
        url: w.illustrationUrl,
        sha256: w.illustrationSha256 ?? null,
      });
    }
  }
  for (const ref of extra) push(ref);
  return { refs, skipped };
}

interface LessonContentBlock {
  type?: string;
  url?: unknown;
  media?: unknown;
}

/**
 * Alcance §3.1(3): bloques `audio`/`listening` (`media.url`, kind audio) e
 * `image` (`block.url`, kind illustration), con `wordId: "lesson:<id>"`.
 * Excluidos §3.2: `video`/`youtubeId`, `text`/rich-text, `word`,
 * `vocabulary`, `quiz` y cualquier otro tipo.
 */
export function lessonBlocksToRefs(
  lessons: ReadonlyArray<{ id: string; content: string }>
): { refs: MediaRef[]; skipped: number } {
  const refs: MediaRef[] = [];
  let skipped = 0;
  const push = (ref: MediaRef): void => {
    if (typeof ref.url !== "string" || !isAllowedMediaUrl(ref.url)) {
      skipped++;
      return;
    }
    refs.push(ref);
  };
  for (const lesson of lessons) {
    let blocks: LessonContentBlock[] = [];
    try {
      const parsed = JSON.parse(lesson.content) as {
        blocks?: LessonContentBlock[];
      };
      blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    } catch {
      continue;
    }
    for (const b of blocks) {
      if (b.type === "audio" || b.type === "listening") {
        const url = (b.media as { url?: unknown } | null)?.url;
        push({
          wordId: `lesson:${lesson.id}`,
          kind: "audio",
          url: url as string,
          sha256: null,
        });
      } else if (b.type === "image") {
        push({
          wordId: `lesson:${lesson.id}`,
          kind: "illustration",
          url: b.url as string,
          sha256: null,
        });
      }
    }
  }
  return { refs, skipped };
}

/**
 * Alcance §3.1(4): `coverImage` de cursos `PUBLISHED`,
 * con `wordId: "course:<id>"`, kind illustration.
 */
export function courseCoversToRefs(
  courses: ReadonlyArray<{
    id: string;
    status: string;
    coverImage: string | null;
  }>
): MediaRef[] {
  const refs: MediaRef[] = [];
  for (const c of courses) {
    if (c.status !== "PUBLISHED") continue;
    if (typeof c.coverImage !== "string") continue;
    if (!isAllowedMediaUrl(c.coverImage)) continue;
    refs.push({
      wordId: `course:${c.id}`,
      kind: "illustration",
      url: c.coverImage,
      sha256: null,
    });
  }
  return refs;
}

/**
 * Poblado tras sincronización exitosa (nunca tras sync fallida: el llamador
 * no lo invoca en ese caso, spec §1.3): manifiesto + descarga con
 * concurrencia acotada + persistencia del manifiesto vigente.
 */
export async function populateMediaCache(
  cache: MediaCache,
  manifest: MediaManifestStore,
  words: readonly WordRow[],
  extra: readonly MediaRef[]
): Promise<{
  rows: MediaManifestRow[];
  ok: string[];
  failed: MediaRef[];
  skipped: number;
}> {
  const rows = await cache.buildManifest(words, extra);
  const { skipped } = collectMediaRefs(words, extra);
  const { ok, failed } = await cache.ensureAllCached(rows);
  for (const row of rows) {
    await manifest.upsertManifest(row);
  }
  return { rows, ok, failed, skipped };
}
