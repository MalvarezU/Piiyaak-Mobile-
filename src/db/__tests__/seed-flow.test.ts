import { describe, it, expect, vi } from "vitest";
import {
  runSeedFlow,
  seedErrorCopy,
  type SeedFlowDeps,
  type SeedFlowTempDb,
} from "../seed-flow";
import { SeedDownloadError } from "../seed-download";
import { SeedVerifyError } from "../seed-manifest";
import { SeedSwapError } from "../seed-swap";
import type { SeedEvent } from "../seed-machine";

/**
 * W3-06b — orquestador `runSeedFlow` (spec §4.2–§4.5): descarga →
 * unzip → verificación → swap, emitiendo eventos de la máquina.
 * Falla en cualquier paso → el swap NO ocurre (assert explícito).
 */
const FILE_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function manifestJson(version = "41") {
  return {
    format: "piiyaak-seed/1",
    contentVersion: version,
    createdAt: "2026-01-01T00:00:00.000Z",
    dbSha256:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    dbBytes: 500,
    zipBytes: 1000,
    files: [
      {
        objectKey: "audios/a.mp3",
        sha256: FILE_A,
        size: 300,
        mimeType: "audio/mpeg",
        localPath: `media/${FILE_A}.mp3`,
      },
    ],
    counts: { words: 1, courses: 0, modules: 0, lessons: 0, mediaFiles: 1 },
    bytesTotal: 800,
    bytesAudio: 300,
    bytesImage: 0,
  };
}

function fakeTempDb(overrides: Partial<SeedFlowTempDb> = {}): SeedFlowTempDb {
  return {
    async integrityCheck() {
      return "ok";
    },
    async getKV(key: string) {
      if (key === "schemaVersion") return "4";
      if (key === "piiyaak:contentVersion") return "41";
      return null;
    },
    async count(table: "words" | "courses" | "lessons") {
      if (table === "words") return 1;
      return 0;
    },
    async listMediaUrls() {
      return [];
    },
    async attachLive() {},
    async copyUserTable() {},
    async countMain() {
      return 5;
    },
    async countLive() {
      return 5;
    },
    async detachLive() {},
    async close() {},
    ...overrides,
  };
}

function fakeDeps(overrides: {
  manifestVersion?: string;
  manifest?: unknown;
  downloadError?: Error;
  fileSize?: number | null;
  tempDb?: SeedFlowTempDb;
  reopenError?: Error;
} = {}): { deps: SeedFlowDeps; calls: string[]; spies: Record<string, ReturnType<typeof vi.fn>> } {
  const calls: string[] = [];
  const files = new Map<string, number>([
    ["file:///tmp/seed-41.zip.part", 1000],
    [`file:///tmp/seed-41/media/${FILE_A}.mp3`, overrides.fileSize ?? 300],
  ]);
  const downloadFile = vi.fn(
    async (
      _url: string,
      _uri: string,
      _o: { offset: number },
      onProgress: (received: number, total: number) => void
    ) => {
      calls.push("downloadFile");
      if (overrides.downloadError) throw overrides.downloadError;
      onProgress(1000, 1000);
    }
  );
  const unzip = vi.fn(async () => {
    calls.push("unzip");
  });
  const reopenLiveDb = vi.fn(async () => {
    calls.push("reopen");
    if (overrides.reopenError) throw overrides.reopenError;
  });
  const adoptVersion = vi.fn(async () => {
    calls.push("adopt");
  });
  const moveFile = vi.fn(async (from: string, to: string) => {
    calls.push(`move:${from}→${to}`);
  });
  const copyFile = vi.fn(async (from: string, to: string) => {
    calls.push(`copy:${from}→${to}`);
  });
  const deps: SeedFlowDeps = {
    tmpDir: "file:///tmp/",
    baseDir: "file:///doc/",
    liveDbPath: "file:///doc/SQLite/piiyaak.db",
    download: {
      tmpDir: "file:///tmp/",
      async fetchJson() {
        calls.push("fetchManifest");
        if (overrides.manifest !== undefined) return overrides.manifest;
        return manifestJson(overrides.manifestVersion);
      },
      async supportsResume() {
        return false;
      },
      async partialSize(uri: string) {
        return files.get(uri) ?? null;
      },
      async removeFile(uri: string) {
        files.delete(uri);
      },
      downloadFile,
      async readRecord() {
        return null;
      },
      // W3.4: reintentos con backoff; en tests el sleep es instantáneo.
      async sleep() {},
      async writeRecord() {},
    },
    unzipApi: {
      async getUncompressedSize() {
        return 5000;
      },
    },
    async ensureDir() {},
    unzip,
    async readFileInfo(uri: string) {
      const size = files.get(uri);
      return size === undefined ? { exists: false, size: null } : { exists: true, size };
    },
    async freeDiskBytes() {
      return 10_000_000;
    },
    async openTempDb() {
      calls.push("openTemp");
      return overrides.tempDb ?? fakeTempDb();
    },
    async closeLiveDb() {
      calls.push("closeLive");
    },
    reopenLiveDb,
    adoptVersion,
    moveFile,
    copyFile,
    async removePath(uri: string) {
      calls.push(`remove:${uri}`);
    },
    async clearDownloadRecord() {
      calls.push("clearRecord");
    },
  };
  return { deps, calls, spies: { downloadFile, unzip, reopenLiveDb, adoptVersion, moveFile } };
}

const OPTS = {
  baseUrl: "https://cdn.example/seed",
  remote: "41",
  serverTime: "2026-01-01T00:00:00.000Z",
};

describe("runSeedFlow", () => {
  it("emite PROGRESS → INSTALL(copiando) → VERIFY → INSTALL(moviendo) → DONE y adopta", async () => {
    const { deps, calls, spies } = fakeDeps();
    const events: SeedEvent[] = [];
    await runSeedFlow(deps, { ...OPTS, emit: (e) => void events.push(e) });
    const kinds = events.map((e) =>
      e.type === "INSTALL" ? `INSTALL:${e.phase}` : e.type
    );
    expect(kinds[0]).toBe("PROGRESS");
    expect(kinds).toContain("INSTALL:copiando datos");
    expect(kinds).toContain("VERIFY");
    expect(kinds).toContain("INSTALL:moviendo medios");
    expect(kinds.at(-1)).toBe("DONE");
    expect(spies.adoptVersion).toHaveBeenCalledWith("41", OPTS.serverTime);
    expect(calls).toContain("move:file:///doc/SQLite/piiyaak.db→file:///doc/SQLite/piiyaak.db.bak");
  });

  it("fallo de verificación: el swap NO ocurre (viva intacta, sin adopción)", async () => {
    const { deps, spies } = fakeDeps({ fileSize: 123 });
    const events: SeedEvent[] = [];
    await expect(runSeedFlow(deps, { ...OPTS, emit: (e) => void events.push(e) })).rejects.toThrow();
    expect(spies.moveFile).not.toHaveBeenCalled();
    expect(spies.adoptVersion).not.toHaveBeenCalled();
    expect(spies.reopenLiveDb).not.toHaveBeenCalled();
  });

  it("fallo de descarga: no hay unzip ni swap", async () => {
    const { deps, spies } = fakeDeps({ downloadError: new Error("red caída") });
    await expect(runSeedFlow(deps, { ...OPTS, emit: () => {} })).rejects.toBeInstanceOf(
      SeedDownloadError
    );
    expect(spies.unzip).not.toHaveBeenCalled();
    expect(spies.moveFile).not.toHaveBeenCalled();
  });

  it("manifiesto desactualizado: aborta antes del unzip", async () => {
    const { deps, spies } = fakeDeps({ manifestVersion: "42" });
    await expect(runSeedFlow(deps, { ...OPTS, emit: () => {} })).rejects.toThrow(/desactualizado/);
    expect(spies.unzip).not.toHaveBeenCalled();
  });
});

describe("seedErrorCopy", () => {
  it("mapea cada fallo a un mensaje específico sin jerga", () => {
    expect(seedErrorCopy(new SeedDownloadError("espacio", "x"))).toMatch(/Espacio insuficiente/);
    expect(seedErrorCopy(new SeedDownloadError("red", "x"))).toMatch(/conexión/);
    expect(seedErrorCopy(new SeedDownloadError("stale", "x"))).toMatch(/cambió/);
    expect(seedErrorCopy(new SeedDownloadError("manifiesto", "x"))).toMatch(/no es válido/);
    expect(seedErrorCopy(new SeedVerifyError("espacio insuficiente"))).toMatch(/Espacio insuficiente/);
    expect(seedErrorCopy(new SeedVerifyError("integrity_check fallido"))).toMatch(/verificación/i);
    expect(seedErrorCopy(new SeedSwapError("reapertura", "x"))).toMatch(/instalar/);
    expect(seedErrorCopy(new Error("raro"))).toMatch(/inesperado/);
  });
});
