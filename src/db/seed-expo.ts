/**
 * W3 — cableado del seed con módulos nativos (SOLO dispositivo).
 *
 * Este módulo importa `expo-file-system`, `expo-sqlite` y
 * `react-native-zip-archive` (vía `loadUnzipApi`): NUNCA se importa desde
 * tests Node. Toda la lógica testeable vive en `seed-flow.ts` y este
 * archivo solo adapta firmas nativas verificadas contra el código
 * instalado (SDK 52, expo-file-system legacy, expo-sqlite con `directory`).
 *
 * Supuestos que se verifican en dispositivo (spec §5.3):
 * - `openDatabaseSync("piiyaak.db", undefined, <file:// tmp>)` abre la db
 *   temporal fuera del directorio SQLite por defecto.
 * - `createDownloadResumable` sobre un `.part` existente continúa la
 *   descarga cuando el servidor acepta rango; si el nativo reinicia desde
 *   cero igual completa correcto (solo pierde bytes, no integridad).
 * - `ATTACH DATABASE` requiere ruta cruda: se despoja el prefijo `file://`.
 */
import * as FileSystem from "expo-file-system";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import { setLocalVersion } from "./version-gate";
import { seedCopySql, type SeedUserTable } from "./seed-swap";
import { loadUnzipApi, unzipSeed, type SeedUnzipApi } from "./seed-unzip";
import { runSeedFlow, seedErrorCopy, type SeedFlowDeps, type SeedFlowTempDb } from "./seed-flow";
import { normalizeSeedRecord } from "./seed-download";
import type { SeedEvent } from "./seed-machine";
import type { WordStore } from "./sqlite-store";

/** Lo que el host (db-context) provee; el resto lo resuelve este módulo. */
export interface ExpoSeedHost {
  liveDbPath: string;
  getStore(): WordStore | null;
  closeLiveDb(): Promise<void>;
  reopenLiveDb(): Promise<WordStore>;
  adoptVersion(remote: string, serverTime: string): Promise<void>;
}

const SEED_RECORD_PREFIX = "piiyaak:seedDownload:";

let cachedUnzipApi: SeedUnzipApi | null = null;
async function unzipApi(): Promise<SeedUnzipApi> {
  if (!cachedUnzipApi) cachedUnzipApi = await loadUnzipApi();
  return cachedUnzipApi;
}

function stripFileScheme(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

function toTempDb(db: SQLiteDatabase): SeedFlowTempDb {
  return {
    async integrityCheck() {
      const row = await db.getFirstAsync<{ integrity_check: string }>(
        "PRAGMA integrity_check"
      );
      return row?.integrity_check ?? "";
    },
    async getKV(key: string) {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM kv WHERE key = ?",
        [key]
      );
      return row?.value ?? null;
    },
    async count(table: "words" | "courses" | "lessons") {
      const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
      return row?.n ?? 0;
    },
    async attachLive(livePath: string) {
      const raw = stripFileScheme(livePath).replace(/'/g, "''");
      await db.execAsync(`ATTACH DATABASE '${raw}' AS live;`);
    },
    async copyUserTable(table: SeedUserTable) {
      await db.execAsync(seedCopySql(table));
    },
    async countMain(table: SeedUserTable) {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM main.${table}`
      );
      return row?.n ?? 0;
    },
    async countLive(table: SeedUserTable) {
      const row = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM live.${table}`
      );
      return row?.n ?? 0;
    },
    async detachLive() {
      await db.execAsync("DETACH DATABASE live;");
    },
    async close() {
      await db.closeAsync();
    },
  };
}

export function buildExpoSeedDeps(host: ExpoSeedHost, documentDir: string): SeedFlowDeps {
  const tmpDir = documentDir;
  // W3.3 — instancia viva: `downloadAsync` la crea y `pauseAndSavable` /
  // `resumeDownload` operan sobre ella. Nunca se construye `Range` manual
  // (ver prohibición en `downloadFile`).
  let activeTask: FileSystem.DownloadResumable | null = null;
  const progressCallback =
    (onProgress: (receivedBytes: number, totalBytes: number) => void) =>
    (progress: {
      totalBytesWritten: number;
      totalBytesExpectedToWrite: number;
    }) => {
      onProgress(
        progress.totalBytesWritten,
        progress.totalBytesExpectedToWrite > 0
          ? progress.totalBytesExpectedToWrite
          : progress.totalBytesWritten
      );
    };
  return {
    tmpDir,
    baseDir: documentDir,
    liveDbPath: host.liveDbPath,
    download: {
      tmpDir,
      async fetchJson(url: string) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        return (await res.json()) as unknown;
      },
      async supportsResume(url: string) {
        try {
          const res = await fetch(url, { method: "HEAD" });
          return res.headers.get("accept-ranges")?.toLowerCase().includes("bytes") ?? false;
        } catch {
          return false;
        }
      },
      async partialSize(partUri: string) {
        const info = await FileSystem.getInfoAsync(partUri);
        if (!info.exists || info.isDirectory) return null;
        return info.size ?? null;
      },
      async removeFile(uri: string) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      },
      async downloadFile(url, partUri, _opts, onProgress) {
        // W3.5 — PROHIBIDO `headers` con `Range` manual en descargas: por
        // especificación `downloadAsync()` sobrescribe el archivo, así que
        // un rango manual concatenaría parcial+completo (corrupción,
        // research P3.1). Resume real SOLO vía `savable` → `resumeAsync()`
        // con guarda `status === 206` (orquestado en `seed-download.ts`).
        // Las opciones viajan como `{}` por diseño, nunca con `headers`.
        activeTask = FileSystem.createDownloadResumable(
          url,
          partUri,
          {},
          progressCallback(onProgress)
        );
        // `offset` (`_opts`) es consultivo: sin `resumeData` no hay
        // continuación real posible sin `Range` manual (prohibido), así que
        // degrada a `downloadAsync()` completa —correcta por semántica de
        // sobreescritura—. El resume real viaja por `resumeDownload()`
        // (savable + guarda 206, orquestado en `seed-download.ts`).
        // Si `downloadAsync()` lanza, `activeTask` sigue apuntando al task
        // (la línea que lo libera no se alcanza) para que
        // `pauseAndSavable()` pueda rescatar el savable en el reintento.
        await activeTask.downloadAsync();
        activeTask = null;
      },
      async pauseAndSavable() {
        const task = activeTask;
        activeTask = null;
        if (!task) return null;
        try {
          await task.pauseAsync();
          return task.savable().resumeData ?? null;
        } catch {
          return null;
        }
      },
      async resumeDownload(url, partUri, resumeData, onProgress) {
        activeTask = FileSystem.createDownloadResumable(
          url,
          partUri,
          {},
          progressCallback(onProgress),
          resumeData
        );
        const result = await activeTask.resumeAsync();
        activeTask = null;
        // `undefined` = task cancelado: sin status no hay 206 que valga,
        // el orquestador lo trata como resume fallido (fresco).
        return { status: result?.status ?? 0 };
      },
      async listPartUris() {
        try {
          const names = await FileSystem.readDirectoryAsync(tmpDir);
          return names
            .filter((name) => name.endsWith(".zip.part"))
            .map((name) => `${tmpDir}${name}`);
        } catch {
          return [];
        }
      },
      async readRecord(remote: string) {
        try {
          const raw = await host.getStore()?.getKV(`${SEED_RECORD_PREFIX}${remote}`);
          if (!raw) return null;
          // Compat W3.1.2: registro antiguo sin `resumeData` → `null`.
          return normalizeSeedRecord(JSON.parse(raw) as unknown);
        } catch {
          return null;
        }
      },
      async writeRecord(remote: string, record) {
        await host.getStore()?.setKV(`${SEED_RECORD_PREFIX}${remote}`, JSON.stringify(record));
      },
    },
    unzipApi: {
      async getUncompressedSize(zipPath: string) {
        return (await unzipApi()).getUncompressedSize(zipPath);
      },
    },
    async ensureDir(dirUri: string) {
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
    },
    async unzip(zipUri: string, targetDir: string) {
      await unzipSeed(await unzipApi(), zipUri, targetDir);
    },
    async readFileInfo(uri: string) {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return { exists: false, size: null };
      return { exists: true, size: info.isDirectory ? null : (info.size ?? null) };
    },
    async freeDiskBytes() {
      return FileSystem.getFreeDiskStorageAsync();
    },
    async openTempDb(tempDbPath: string) {
      const dir = tempDbPath.slice(0, tempDbPath.lastIndexOf("/") + 1);
      const name = tempDbPath.slice(tempDbPath.lastIndexOf("/") + 1);
      const db = openDatabaseSync(name, undefined, dir);
      return toTempDb(db);
    },
    closeLiveDb: () => host.closeLiveDb(),
    reopenLiveDb: async () => {
      await host.reopenLiveDb();
    },
    adoptVersion: (remote, serverTime) => host.adoptVersion(remote, serverTime),
    async moveFile(from: string, to: string) {
      await FileSystem.moveAsync({ from, to });
    },
    async removePath(uri: string) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },
    async clearDownloadRecord(remote: string) {
      // `WordStore` no expone borrado: lápida vacía que `readRecord` trata
      // como ausente (JSON inválido → null).
      await host.getStore()?.setKV(`${SEED_RECORD_PREFIX}${remote}`, "");
    },
  };
}

export interface ExpoSeedRunOpts {
  baseUrl: string;
  remote: string;
  serverTime: string;
  emit: (event: SeedEvent) => void;
}

/** Entrada del host: ejecuta el flujo y traduce el error a copy de UI. */
export async function runExpoSeedFlow(
  host: ExpoSeedHost,
  documentDir: string,
  opts: ExpoSeedRunOpts
): Promise<void> {
  await runSeedFlow(buildExpoSeedDeps(host, documentDir), opts);
}

export { runSeedFlow, seedErrorCopy };
export { setLocalVersion };
