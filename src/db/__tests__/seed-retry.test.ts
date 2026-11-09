import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  downloadSeed,
  normalizeSeedRecord,
  SEED_DOWNLOAD_RETRY_DELAYS,
  type SeedDownloadDeps,
} from "../seed-download";
import { decideResume } from "../seed-resume";

/**
 * W3.2 + W3.3 — registro kv con `resumeData` opaco, compatibilidad,
 * sweep de `.part` ajenos, reintentos y guarda 206 (spec §W3.1–§W3.4).
 * Adaptador inyectable, sin nativo: corre en Node.
 */
const FILE_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function manifestJson(version = "41", zipBytes = 1000): unknown {
  return {
    format: "piiyaak-seed/1",
    contentVersion: version,
    createdAt: "2026-01-01T00:00:00.000Z",
    dbSha256:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    dbBytes: 500,
    zipBytes,
    files: [
      {
        objectKey: "audios/a.mp3",
        sha256: FILE_A,
        size: 500,
        mimeType: "audio/mpeg",
        localPath: `media/${FILE_A}.mp3`,
      },
    ],
    counts: { words: 1, courses: 0, modules: 0, lessons: 0, mediaFiles: 1 },
    bytesTotal: 1000,
    bytesAudio: 500,
    bytesImage: 0,
  };
}

const OPAQUE_BLOB = `android-offset-512:${"B".repeat(512)}`;

interface World {
  kv: Map<string, string>;
  files: Map<string, number>;
  removed: string[];
  sleeps: number[];
  downloadCalls: Array<{ offset: number }>;
  resumeCalls: Array<{ resumeData: string }>;
}

function fakeDeps(opts: {
  manifest?: unknown | Error;
  manifestVersion?: string;
  resumeOk?: boolean;
  partialBytes?: number;
  seedKvRaw?: string | null;
  failDownload?: Error | null;
  failTimes?: number;
  failResumeTimes?: number;
  resumeStatus?: number;
  savedResume?: string | null;
  extraParts?: string[];
}): { deps: SeedDownloadDeps; world: World } {
  const world: World = {
    kv: new Map(),
    files: new Map(),
    removed: [],
    sleeps: [],
    downloadCalls: [],
    resumeCalls: [],
  };
  const partUri = "file:///tmp/seed-41.zip.part";
  if (opts.partialBytes !== undefined) world.files.set(partUri, opts.partialBytes);
  for (const p of opts.extraParts ?? []) world.files.set(p, 100);
  if (opts.seedKvRaw !== undefined && opts.seedKvRaw !== null) {
    world.kv.set("piiyaak:seedDownload:41", opts.seedKvRaw);
  }
  let failuresLeft = opts.failTimes ?? (opts.failDownload ? 1 : 0);
  let resumeFailuresLeft = opts.failResumeTimes ?? 0;
  const downloadFile = vi.fn(
    async (
      _url: string,
      uri: string,
      o: { offset: number },
      onProgress: (received: number, total: number) => void
    ) => {
      world.downloadCalls.push({ offset: o.offset });
      if (failuresLeft > 0 && opts.failDownload) {
        failuresLeft -= 1;
        const half = Math.floor(1000 / 2);
        world.files.set(uri, half);
        throw opts.failDownload;
      }
      onProgress(1000, 1000);
      world.files.set(uri, 1000);
    }
  );
  const deps: SeedDownloadDeps = {
    tmpDir: "file:///tmp/",
    async fetchJson() {
      if (opts.manifest instanceof Error) throw opts.manifest;
      if (opts.manifest !== undefined) return opts.manifest;
      return manifestJson(opts.manifestVersion ?? "41");
    },
    async supportsResume() {
      return opts.resumeOk ?? true;
    },
    async partialSize(uri: string) {
      return world.files.get(uri) ?? null;
    },
    async removeFile(uri: string) {
      world.removed.push(uri);
      world.files.delete(uri);
    },
    downloadFile,
    async readRecord(remote: string) {
      const raw = world.kv.get(`piiyaak:seedDownload:${remote}`);
      if (!raw) return null;
      return normalizeSeedRecord(JSON.parse(raw) as unknown);
    },
    async writeRecord(remote: string, record) {
      world.kv.set(`piiyaak:seedDownload:${remote}`, JSON.stringify(record));
    },
    async sleep(ms: number) {
      world.sleeps.push(ms);
    },
    async listPartUris() {
      return [...world.files.keys()].filter((k) => k.endsWith(".zip.part"));
    },
    async pauseAndSavable() {
      return opts.savedResume ?? null;
    },
    async resumeDownload(
      _url: string,
      uri: string,
      resumeData: string,
      onProgress: (received: number, total: number) => void
    ) {
      world.resumeCalls.push({ resumeData });
      if (resumeFailuresLeft > 0 && opts.failDownload) {
        resumeFailuresLeft -= 1;
        world.files.set(uri, 500);
        throw opts.failDownload;
      }
      onProgress(1000, 1000);
      world.files.set(uri, 1000);
      return { status: opts.resumeStatus ?? 206 };
    },
  };
  return { deps, world };
}

function readKvRecord(world: World, remote = "41"): Record<string, unknown> | null {
  const raw = world.kv.get(`piiyaak:seedDownload:${remote}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe("registro kv con resumeData opaco (W3.2)", () => {
  it("round-trip: el opaco se preserva byte a byte sin parseo", () => {
    const rec = {
      partName: "seed-41.zip.part",
      totalBytes: 1000,
      updatedAt: "2026-11-09T00:00:00.000Z",
      resumeData: OPAQUE_BLOB,
    };
    const back = normalizeSeedRecord(JSON.parse(JSON.stringify(rec)) as unknown);
    expect(back?.resumeData).toBe(OPAQUE_BLOB);
    expect(back).toEqual(rec);
  });

  it("registro antiguo sin resumeData se lee como null y decide fresh", () => {
    const back = normalizeSeedRecord({
      partName: "seed-41.zip.part",
      totalBytes: 1000,
      updatedAt: "x",
    });
    expect(back?.resumeData).toBeNull();
    expect(
      decideResume({
        record: back,
        existingBytes: 500,
        supportsResume: true,
        resumedStatus: null,
      })
    ).toEqual({ action: "fresh" });
  });

  it("registro inválido (JSON válido, forma rota) se lee como ausente", () => {
    expect(normalizeSeedRecord(null)).toBeNull();
    expect(normalizeSeedRecord({ partName: 42 })).toBeNull();
    expect(normalizeSeedRecord({ partName: "seed-41.zip.part" })).toBeNull();
  });

  it("downloadSeed preserva el resumeData heredado en el registro tras éxito", async () => {
    const { deps, world } = fakeDeps({
      partialBytes: 500,
      seedKvRaw: JSON.stringify({
        partName: "seed-41.zip.part",
        totalBytes: 1000,
        updatedAt: "x",
        resumeData: OPAQUE_BLOB,
      }),
      resumeOk: true,
      resumeStatus: 206,
    });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(res.resumed).toBe(true);
    expect(readKvRecord(world)?.resumeData).toBe(OPAQUE_BLOB);
  });

  it("cambio de versión: el .part ajeno se elimina antes de descargar", async () => {
    const { deps, world } = fakeDeps({
      manifestVersion: "42",
      extraParts: ["file:///tmp/seed-41.zip.part"],
    });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "42", () => {});
    expect(res.resumed).toBe(false);
    expect(world.removed).toContain("file:///tmp/seed-41.zip.part");
    expect(world.files.get("file:///tmp/seed-42.zip.part")).toBe(1000);
  });
});

describe("reintentos con backoff (W3.3–W3.4)", () => {
  it("error recuperable de red: 3 intentos con delays [2000, 8000]", async () => {
    const { deps, world } = fakeDeps({
      failDownload: new Error("timeout de red"),
      failTimes: 2,
    });
    const seen: Array<[number, number]> = [];
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", (r, t) =>
      seen.push([r, t])
    );
    expect(world.downloadCalls).toHaveLength(3);
    expect(world.sleeps).toEqual([...SEED_DOWNLOAD_RETRY_DELAYS]);
    expect(SEED_DOWNLOAD_RETRY_DELAYS).toEqual([2000, 8000]);
    expect(world.files.get("file:///tmp/seed-41.zip.part")).toBe(1000);
    expect(seen.at(-1)).toEqual([1000, 1000]);
    expect(res.resumed).toBe(true);
  });

  it("agotados los 3 intentos: propaga el error de red", async () => {
    const { deps, world } = fakeDeps({
      failDownload: new Error("timeout de red"),
      failTimes: 10,
    });
    await expect(
      downloadSeed(deps, "https://cdn.example/seed", "41", () => {})
    ).rejects.toThrow(/timeout/);
    expect(world.downloadCalls).toHaveLength(3);
    expect(world.sleeps).toEqual([2000, 8000]);
  });

  it("error NO recuperable (espacio): no reintenta", async () => {
    const { deps, world } = fakeDeps({
      failDownload: new Error("No space left on device (ENOSPC)"),
      failTimes: 5,
    });
    await expect(
      downloadSeed(deps, "https://cdn.example/seed", "41", () => {})
    ).rejects.toThrow(/espacio/);
    expect(world.downloadCalls).toHaveLength(1);
    expect(world.sleeps).toEqual([]);
  });

  it("error de integridad (stale/manifiesto): no descarga ni reintenta", async () => {
    const stale = fakeDeps({ manifestVersion: "42" });
    await expect(
      downloadSeed(stale.deps, "https://cdn.example/seed", "41", () => {})
    ).rejects.toThrow(/desactualizado/);
    expect(stale.world.downloadCalls).toHaveLength(0);
    expect(stale.world.sleeps).toEqual([]);

    const broken = fakeDeps({ manifest: { format: "piiyaak-seed/9" } as never });
    await expect(
      downloadSeed(broken.deps, "https://cdn.example/seed", "41", () => {})
    ).rejects.toThrow();
    expect(broken.world.downloadCalls).toHaveLength(0);
    expect(broken.world.sleeps).toEqual([]);
  });
});

describe("resume savable con guarda 206 (W3.3)", () => {
  function savableDeps(extra: Parameters<typeof fakeDeps>[0] = {}) {
    return fakeDeps({
      partialBytes: 500,
      seedKvRaw: JSON.stringify({
        partName: "seed-41.zip.part",
        totalBytes: 1000,
        updatedAt: "x",
        resumeData: OPAQUE_BLOB,
      }),
      resumeOk: true,
      ...extra,
    });
  }

  it("resume 206: continúa sin descarga fresca", async () => {
    const { deps, world } = savableDeps({ resumeStatus: 206 });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(world.resumeCalls).toEqual([{ resumeData: OPAQUE_BLOB }]);
    expect(world.downloadCalls).toHaveLength(0);
    expect(world.removed).not.toContain("file:///tmp/seed-41.zip.part");
    expect(res.resumed).toBe(true);
  });

  it("resume 200 (rango ignorado): truncate-and-fresh en el mismo intento", async () => {
    const { deps, world } = savableDeps({ resumeStatus: 200 });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(world.resumeCalls).toHaveLength(1);
    expect(world.removed).toContain("file:///tmp/seed-41.zip.part");
    expect(world.downloadCalls).toEqual([{ offset: 0 }]);
    expect(world.files.get("file:///tmp/seed-41.zip.part")).toBe(1000);
    expect(readKvRecord(world)?.resumeData).toBeNull();
    expect(res.resumed).toBe(false);
  });

  it("fallo de red en resumeAsync: pausa, persiste savable nuevo y reintenta", async () => {
    const { deps, world } = savableDeps({
      failDownload: new Error("red caída a mitad del resume"),
      failResumeTimes: 1,
      resumeStatus: 206,
      savedResume: "savable-nuevo-opaco",
    });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(world.resumeCalls).toEqual([
      { resumeData: OPAQUE_BLOB },
      { resumeData: "savable-nuevo-opaco" },
    ]);
    expect(world.sleeps).toEqual([2000]);
    expect(readKvRecord(world)?.resumeData).toBe("savable-nuevo-opaco");
    expect(res.resumed).toBe(true);
  });

  it("sin Accept-Ranges: fresh silencioso aunque haya savable", async () => {
    const { deps, world } = savableDeps({ resumeOk: false });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(world.resumeCalls).toHaveLength(0);
    expect(world.downloadCalls).toEqual([{ offset: 0 }]);
    expect(world.removed).toContain("file:///tmp/seed-41.zip.part");
    expect(res.resumed).toBe(false);
  });
});

describe("prohibición de Range manual (W3.5)", () => {
  it("ningún código de seed-expo pasa headers Range a downloadAsync", async () => {
    const src = await readFile("src/db/seed-expo.ts", "utf8");
    // Sin comentarios; el literal "accept-ranges" del HEAD check es
    // detección de capacidad vigente (§W3.2), no un header de descarga.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/["']accept-ranges["']/gi, "");
    expect(code).not.toMatch(/range/i);
  });
});
