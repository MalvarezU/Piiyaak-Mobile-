/**
 * W3 — swap atómico con preservación (spec §4.5, 8 pasos en orden).
 *
 * La db viva NO se toca hasta el paso 5. Las 3 únicas tablas de usuario
 * que se copian son `course_progress`, `outbox` e `history` (nada más).
 * Deps inyectadas: `expo-sqlite`/`expo-file-system` no existen en Node;
 * el cableado real vive en el llamador (db-context, W3-06) y el SQL
 * exacto se verifica por contrato estático.
 */
import type { SeedManifest } from "./seed-manifest";
import { urlCacheFileName } from "./media-cache";

export const SEED_USER_TABLES = ["course_progress", "outbox", "history"] as const;
export type SeedUserTable = (typeof SEED_USER_TABLES)[number];

/** SQL exacto del paso 3 (verificado por contrato estático + dispositivo). */
export function seedCopySql(table: SeedUserTable): string {
  return `INSERT OR REPLACE INTO main.${table} SELECT * FROM live.${table};`;
}

export class SeedSwapError extends Error {
  constructor(
    public readonly reason: string,
    message: string,
    public readonly liveRestored = false
  ) {
    super(`[seed-swap] ${reason}: ${message}`);
    this.name = "SeedSwapError";
  }
}

/** Conexión temporal sobre la db nueva (producción: `expo-sqlite`). */
export interface SeedSwapDb {
  integrityCheck(): Promise<string>;
  attachLive(livePath: string): Promise<void>;
  copyUserTable(table: SeedUserTable): Promise<void>;
  countMain(table: SeedUserTable): Promise<number>;
  countLive(table: SeedUserTable): Promise<number>;
  detachLive(): Promise<void>;
  close(): Promise<void>;
}

export interface SeedSwapDeps {
  closeLive(): Promise<void>;
  openTemp(tempDbPath: string): Promise<SeedSwapDb>;
  moveFile(from: string, to: string): Promise<void>;
  /** Copia para el mismo contenido servido por varias URLs (dedup sha). */
  copyFile(from: string, to: string): Promise<void>;
  /** Garantiza audios/ e illustrations/ antes de mover (move falla sin dir). */
  ensureDir(dirUri: string): Promise<void>;
  reopenLive(): Promise<void>;
  adoptVersion(remote: string, serverTime: string): Promise<void>;
  removePath(uri: string): Promise<void>;
  clearDownloadRecord(remote: string): Promise<void>;
}

export interface SeedSwapOpts {
  liveDbPath: string;
  tempDbPath: string;
  tmpDir: string;
  baseDir: string;
  manifest: SeedManifest;
  remote: string;
  serverTime: string;
  partUri: string;
  /**
   * URLs vigentes de medios (palabras + portadas publicadas), leídas de la
   * DB nueva durante la verificación. El matching file↔URL es por basename:
   * permite mover cada archivo con la EXACTA clave `url_<norm>` que
   * `MediaCache.localUriFor` consulta (nombres por contenido quedaban
   * aislados: nadie los buscaba).
   */
  mediaUrls: ReadonlyArray<{ url: string; kind: "audio" | "illustration" }>;
  /** Hook opcional antes de mover medios (el flujo emite "moviendo medios"). */
  onMediaPhase?: () => void;
}

type SeedMediaKind = "audio" | "illustration";

function mediaDestFor(baseDir: string, url: string, kind: SeedMediaKind): string {
  return `${baseDir}${kind === "audio" ? "audios/" : "illustrations/"}${urlCacheFileName(url, kind)}`;
}

export async function swapSeedContent(deps: SeedSwapDeps, opts: SeedSwapOpts): Promise<void> {
  const { liveDbPath, tempDbPath, tmpDir, baseDir, manifest, remote, serverTime, partUri } = opts;
  const bakPath = `${liveDbPath}.bak`;

  // 1. Cerrar la viva (el provider queda no-listo durante el swap).
  await deps.closeLive();
  // 2. Abrir la nueva + integrity_check; distinto de ok → abortar.
  const temp = await deps.openTemp(tempDbPath);
  try {
    const integrity = (await temp.integrityCheck()).trim().toLowerCase();
    if (integrity !== "ok") {
      throw new SeedSwapError("integrity", `esperado ok, real ${JSON.stringify(integrity)}`);
    }
    // 3. ATTACH + copia exacta de las 3 tablas de usuario.
    await temp.attachLive(liveDbPath);
    for (const table of SEED_USER_TABLES) {
      await temp.copyUserTable(table);
    }
    // 4. Verificar COUNT(main) === COUNT(live); divergencia → DETACH + abortar.
    for (const table of SEED_USER_TABLES) {
      const [main, live] = await Promise.all([temp.countMain(table), temp.countLive(table)]);
      if (main !== live) {
        await temp.detachLive();
        throw new SeedSwapError("conteo", `${table}: nueva ${main} !== viva ${live}`);
      }
    }
    // 5. DETACH, cierre y renombre atómico (mismo volumen).
    await temp.detachLive();
  } finally {
    await temp.close();
  }
  await deps.moveFile(liveDbPath, bakPath);
  await deps.moveFile(tempDbPath, liveDbPath);
  // 6. Reapertura + adopción conjunta; fallo → restaurar .bak y error.
  try {
    await deps.reopenLive();
    await deps.adoptVersion(remote, serverTime);
  } catch (e) {
    await deps.moveFile(bakPath, liveDbPath);
    try {
      await deps.reopenLive();
    } catch {
      // La viva queda restaurada en disco aunque cerrada; el llamador
      // muestra error + "Continuar solo con texto" y reabre al reintentar.
    }
    throw new SeedSwapError(
      "reapertura",
      e instanceof Error ? e.message : String(e),
      true
    );
  }
  // 7. Medios: dirs garantizados + clave EXACTA que MediaCache resuelve
  // (`url_<url-normalizada>`). Matching file↔URL por basename; el mismo
  // contenido servido por varias URLs se copia por URL. Sin URL vigente
  // conocida, el archivo conserva su nombre por contenido (no se pierde).
  opts.onMediaPhase?.();
  await deps.ensureDir(`${baseDir}audios/`);
  await deps.ensureDir(`${baseDir}illustrations/`);
  const urlsByBase = new Map<string, Array<{ url: string; kind: SeedMediaKind }>>();
  for (const m of opts.mediaUrls) {
    const base = m.url.split("?")[0]?.split("/").pop()?.toLowerCase() ?? "";
    if (!base) continue;
    const list = urlsByBase.get(base) ?? [];
    list.push({ url: m.url, kind: m.kind });
    urlsByBase.set(base, list);
  }
  for (const file of manifest.files) {
    const src = `${tmpDir}${file.localPath}`;
    const base = (file.objectKey.split("/").pop() ?? "").toLowerCase();
    const matches = urlsByBase.get(base) ?? [];
    if (matches.length === 0) {
      const dir = file.mimeType.startsWith("audio/") ? "audios/" : "illustrations/";
      const fileName = file.localPath.split("/").pop() ?? `${file.sha256}`;
      await deps.moveFile(src, `${baseDir}${dir}${fileName}`);
      continue;
    }
    const first = matches[0]!;
    const dest = mediaDestFor(baseDir, first.url, first.kind);
    await deps.moveFile(src, dest);
    for (const m of matches.slice(1)) {
      await deps.copyFile(dest, mediaDestFor(baseDir, m.url, m.kind));
    }
  }
  // 8. Limpieza solo tras reapertura + adopción exitosas.
  await deps.removePath(tmpDir);
  await deps.removePath(partUri);
  await deps.clearDownloadRecord(remote);
  await deps.removePath(bakPath);
}
