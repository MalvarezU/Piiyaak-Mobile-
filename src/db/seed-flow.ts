/**
 * W3 — orquestador del seed (spec §4.2–§4.5): descarga → unzip →
 * verificación → swap, emitiendo eventos de `seed-machine.ts`.
 * Todo I/O inyectado (`SeedFlowDeps`); el cableado con `expo-*` vive en
 * `src/db/seed-expo.ts` (solo dispositivo, nunca en tests).
 * Cualquier fallo propaga y el swap NO ocurre (la viva queda intacta o
 * restaurada; el llamador muestra error + "Continuar solo con texto").
 */
import { downloadSeed, SeedDownloadError, type SeedDownloadDeps } from "./seed-download";
import { verifySeedDir, SeedVerifyError } from "./seed-manifest";
import { swapSeedContent, SeedSwapError, type SeedUserTable } from "./seed-swap";
import { unzipSeed } from "./seed-unzip";
import type { SeedEvent } from "./seed-machine";

export interface SeedFlowTempDb {
  integrityCheck(): Promise<string>;
  getKV(key: string): Promise<string | null>;
  count(table: "words" | "courses" | "lessons"): Promise<number>;
  /** URLs de medios vigentes (palabras + portadas publicadas). */
  listMediaUrls(): Promise<Array<{ url: string; kind: "audio" | "illustration" }>>;
  attachLive(livePath: string): Promise<void>;
  copyUserTable(table: SeedUserTable): Promise<void>;
  countMain(table: SeedUserTable): Promise<number>;
  countLive(table: SeedUserTable): Promise<number>;
  detachLive(): Promise<void>;
  close(): Promise<void>;
}

export interface SeedFlowDeps {
  tmpDir: string;
  baseDir: string;
  liveDbPath: string;
  download: SeedDownloadDeps;
  /** Solo la guarda de espacio; la extracción va por `unzip` (con progreso). */
  unzipApi: { getUncompressedSize(zipPath: string): Promise<number> };
  ensureDir(dirUri: string): Promise<void>;
  unzip(zipUri: string, targetDir: string): Promise<void>;
  readFileInfo(uri: string): Promise<{ exists: boolean; size: number | null }>;
  freeDiskBytes(): Promise<number>;
  openTempDb(tempDbPath: string): Promise<SeedFlowTempDb>;
  closeLiveDb(): Promise<void>;
  reopenLiveDb(): Promise<void>;
  adoptVersion(remote: string, serverTime: string): Promise<void>;
  moveFile(from: string, to: string): Promise<void>;
  /** Copia para el mismo contenido servido por varias URLs (dedup sha). */
  copyFile(from: string, to: string): Promise<void>;
  removePath(uri: string): Promise<void>;
  clearDownloadRecord(remote: string): Promise<void>;
}

export interface SeedFlowOpts {
  baseUrl: string;
  remote: string;
  serverTime: string;
  emit: (event: SeedEvent) => void;
}

export async function runSeedFlow(deps: SeedFlowDeps, opts: SeedFlowOpts): Promise<void> {
  const { baseUrl, remote, serverTime, emit } = opts;
  const tmpSeedDir = `${deps.tmpDir}seed-${remote}/`;

  const { manifest, zipUri } = await downloadSeed(
    deps.download,
    baseUrl,
    remote,
    (receivedBytes, totalBytes) => emit({ type: "PROGRESS", receivedBytes, totalBytes })
  );

  emit({ type: "INSTALL", phase: "copiando datos" });
  await deps.ensureDir(tmpSeedDir);
  const uncompressedBytes = await deps.unzipApi.getUncompressedSize(zipUri);
  await deps.unzip(zipUri, tmpSeedDir);

  emit({ type: "VERIFY" });
  const temp = await deps.openTempDb(`${tmpSeedDir}piiyaak.db`);
  await verifySeedDir({
    fs: { fileInfo: deps.readFileInfo, freeDiskBytes: deps.freeDiskBytes },
    db: temp,
    tmpDir: tmpSeedDir,
    manifest,
    remote,
    uncompressedBytes,
  });

  await swapSeedContent(
    {
      closeLive: deps.closeLiveDb,
      openTemp: async () => temp,
      moveFile: deps.moveFile,
      copyFile: deps.copyFile,
      ensureDir: deps.ensureDir,
      reopenLive: deps.reopenLiveDb,
      adoptVersion: deps.adoptVersion,
      removePath: deps.removePath,
      clearDownloadRecord: deps.clearDownloadRecord,
    },
    {
      liveDbPath: deps.liveDbPath,
      tempDbPath: `${tmpSeedDir}piiyaak.db`,
      tmpDir: tmpSeedDir,
      baseDir: deps.baseDir,
      manifest,
      remote,
      serverTime,
      partUri: zipUri,
      mediaUrls: await temp.listMediaUrls(),
      onMediaPhase: () => emit({ type: "INSTALL", phase: "moviendo medios" }),
    }
  );
  emit({ type: "DONE" });
}

/** Mensaje específico por fallo (spec §4.2); nunca bloqueo sin salida. */
export function seedErrorCopy(error: unknown): string {
  if (error instanceof SeedDownloadError) {
    switch (error.reason) {
      case "espacio":
        return "Espacio insuficiente para descargar el contenido.";
      case "red":
        return "No se pudo descargar el contenido. Revisá tu conexión.";
      case "stale":
        return "El contenido publicado cambió durante la descarga.";
      case "manifiesto":
        return "El contenido publicado no es válido.";
    }
  }
  if (error instanceof SeedVerifyError) {
    if (error.reason === "espacio insuficiente") {
      return "Espacio insuficiente para instalar el contenido.";
    }
    return "La verificación del contenido falló.";
  }
  if (error instanceof SeedSwapError) return "No se pudo instalar el contenido.";
  if (error instanceof Error && /no space|enospc/i.test(error.message)) {
    return "Espacio insuficiente para instalar el contenido.";
  }
  return "Ocurrió un error inesperado.";
}

/** Re-export para el cableado del dispositivo. */
export { unzipSeed };
