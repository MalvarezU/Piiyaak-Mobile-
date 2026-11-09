import { describe, it, expect, vi } from "vitest";
import {
  downloadSeed,
  seedFileUrls,
  SeedDownloadError,
  type SeedDownloadDeps,
  type SeedManifestJson,
} from "../seed-download";

/**
 * W3-04 — descarga reanudable (spec §4.3): contrato, no mecanismo del SO.
 * `.part` + registro kv `piiyaak:seedDownload:<N>`; interrupción a mitad →
 * segundo intento completa sin corrupción (reanudación o reinicio limpio);
 * db viva intacta (este módulo nunca la toca por construcción: no recibe
 * handle de db; el assert es que `downloadFile`/`removeFile` solo operan
 * bajo `tmpDir`).
 */
const FILE_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function manifestJson(version = "41", zipBytes = 1000): SeedManifestJson {
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

interface FakeFs {
  files: Map<string, number>;
  removed: string[];
}

function fakeDeps(opts: {
  manifest?: SeedManifestJson | Error;
  resumeOk?: boolean;
  failDownload?: Error | null;
  partialBytes?: number;
  record?: { partName: string; totalBytes: number; updatedAt: string } | null;
  recordWrites?: { partName: string; totalBytes: number }[];
}): { deps: SeedDownloadDeps; fs: FakeFs; spies: { download: ReturnType<typeof vi.fn> } } {
  const fs: FakeFs = { files: new Map(), removed: [] };
  const partUri = "file:///tmp/seed-41.zip.part";
  if (opts.partialBytes !== undefined) fs.files.set(partUri, opts.partialBytes);
  let record = opts.record === undefined ? null : opts.record;
  const recordWrites: { partName: string; totalBytes: number }[] = opts.recordWrites ?? [];
  const download = vi.fn(
    async (
      _url: string,
      uri: string,
      o: { offset: number },
      onProgress: (r: number, t: number) => void
    ) => {
      if (opts.failDownload) {
        // Interrupción a mitad: deja el parcial escrito y lanza.
        const half = Math.floor(1000 / 2);
        fs.files.set(uri, (o.offset || 0) + half - (o.offset || 0) > 0 ? half : half);
        throw opts.failDownload;
      }
      const total = 1000;
      const from = o.offset || 0;
      onProgress(total, total);
      fs.files.set(uri, total);
      void from;
    }
  );
  const deps: SeedDownloadDeps = {
    tmpDir: "file:///tmp/",
    async fetchJson() {
      if (opts.manifest instanceof Error) throw opts.manifest;
      return opts.manifest ?? manifestJson();
    },
    async supportsResume() {
      return opts.resumeOk ?? true;
    },
    async partialSize(uri: string) {
      return fs.files.get(uri) ?? null;
    },
    async removeFile(uri: string) {
      fs.removed.push(uri);
      fs.files.delete(uri);
    },
    downloadFile: download,
    async readRecord() {
      return record;
    },
    async writeRecord(_remote: string, rec) {
      record = { ...rec, updatedAt: rec.updatedAt };
      recordWrites.push({ partName: rec.partName, totalBytes: rec.totalBytes });
    },
  };
  return { deps, fs, spies: { download } };
}

describe("seedFileUrls", () => {
  it("construye URLs well-known desde la base, nunca desde latest.json", () => {
    const u = seedFileUrls("https://cdn.example/seed", "41");
    expect(u.manifestUrl).toBe("https://cdn.example/seed/seed/41/manifest.json");
    expect(u.zipUrl).toBe("https://cdn.example/seed/seed/41/piiyaak-seed.zip");
  });
});

describe("downloadSeed", () => {
  it("descarga fresca completa y registra el .part en kv", async () => {
    const { deps, fs } = fakeDeps({});
    const seen: Array<[number, number]> = [];
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", (r, t) =>
      seen.push([r, t])
    );
    expect(res.manifest.contentVersion).toBe("41");
    expect(res.zipUri).toBe("file:///tmp/seed-41.zip.part");
    expect(res.resumed).toBe(false);
    expect(fs.files.get("file:///tmp/seed-41.zip.part")).toBe(1000);
    expect(seen.at(-1)).toEqual([1000, 1000]);
  });

  it("interrupción a mitad: segundo intento reanuda y completa sin corrupción", async () => {
    const shared = fakeDeps({ failDownload: new Error("red caída") });
    await expect(
      downloadSeed(shared.deps, "https://cdn.example/seed", "41", () => {})
    ).rejects.toThrow(/red/);
    // Reinicio: mismo registro + parcial, servidor acepta rango.
    const second = fakeDeps({
      partialBytes: 500,
      record: { partName: "seed-41.zip.part", totalBytes: 1000, updatedAt: "x" },
      resumeOk: true,
    });
    const res = await downloadSeed(second.deps, "https://cdn.example/seed", "41", () => {});
    expect(res.resumed).toBe(true);
    expect(second.fs.files.get("file:///tmp/seed-41.zip.part")).toBe(1000);
    expect(second.fs.removed).not.toContain("file:///tmp/seed-41.zip.part");
  });

  it("si el servidor no acepta rango: borra el parcial y descarga fresca", async () => {
    const { deps, fs, spies } = fakeDeps({
      partialBytes: 500,
      record: { partName: "seed-41.zip.part", totalBytes: 1000, updatedAt: "x" },
      resumeOk: false,
    });
    const res = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {});
    expect(res.resumed).toBe(false);
    expect(fs.removed).toContain("file:///tmp/seed-41.zip.part");
    expect(fs.files.get("file:///tmp/seed-41.zip.part")).toBe(1000);
    expect(spies.download).toHaveBeenCalledOnce();
  });

  it("almacenamiento lleno: error específico con reintento, parcial aislado en .part", async () => {
    const { deps, fs } = fakeDeps({ failDownload: new Error("No space left on device (ENOSPC)") });
    const err = await downloadSeed(deps, "https://cdn.example/seed", "41", () => {}).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(SeedDownloadError);
    expect((err as SeedDownloadError).reason).toBe("espacio");
    // El parcial queda aislado en .part; nada se promueve fuera de tmpDir.
    expect([...fs.files.keys()].every((k) => k.startsWith("file:///tmp/"))).toBe(true);
  });

  it("manifiesto desactualizado (otra versión): aborta sin descargar el zip", async () => {
    const { deps, spies } = fakeDeps({ manifest: manifestJson("42") });
    await expect(downloadSeed(deps, "https://cdn.example/seed", "41", () => {})).rejects.toThrow(
      /desactualizado/
    );
    expect(spies.download).not.toHaveBeenCalled();
  });

  it("manifiesto inválido: aborta en el borde sin tocar disco", async () => {
    const { deps, spies, fs } = fakeDeps({ manifest: { format: "piiyaak-seed/9" } as never });
    await expect(downloadSeed(deps, "https://cdn.example/seed", "41", () => {})).rejects.toThrow();
    expect(spies.download).not.toHaveBeenCalled();
    expect(fs.files.size).toBe(0);
  });
});
