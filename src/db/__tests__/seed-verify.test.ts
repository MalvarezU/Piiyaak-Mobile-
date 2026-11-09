import { describe, it, expect } from "vitest";
import {
  verifySeedDir,
  SeedVerifyError,
  type SeedManifest,
  type SeedVerifyDb,
  type SeedVerifyFs,
} from "../seed-manifest";

/**
 * W3-02 — verificación en el dispositivo SIN re-hash por archivo
 * (spec §4.4): existencia + size, guarda de espacio, integrity_check,
 * schemaVersion, contentVersion conjunta y conteos. Cualquier fallo →
 * sin swap (el llamador no avanza; ver flujo en W3-06).
 */
const FILE_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FILE_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const MANIFEST: SeedManifest = {
  format: "piiyaak-seed/1",
  contentVersion: "41",
  createdAt: "2026-01-01T00:00:00.000Z",
  dbSha256:
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  dbBytes: 1000,
  zipBytes: 2000,
  files: [
    {
      objectKey: "audios/a.mp3",
      sha256: FILE_A,
      size: 100,
      mimeType: "audio/mpeg",
      localPath: `media/${FILE_A}.mp3`,
    },
    {
      objectKey: "images/b.png",
      sha256: FILE_B,
      size: 200,
      mimeType: "image/png",
      localPath: `media/${FILE_B}.png`,
    },
  ],
  counts: { words: 1, courses: 1, modules: 1, lessons: 1, mediaFiles: 2 },
  bytesTotal: 1300,
  bytesAudio: 100,
  bytesImage: 200,
};

function fakeFs(sizes: Record<string, number> = {}, free = 10_000_000): SeedVerifyFs {
  const base = "file:///tmp/seed-41/";
  const table: Record<string, number> = {
    [`${base}media/${FILE_A}.mp3`]: 100,
    [`${base}media/${FILE_B}.png`]: 200,
    ...sizes,
  };
  return {
    async fileInfo(uri: string) {
      const size = table[uri];
      return size === undefined ? { exists: false, size: null } : { exists: true, size };
    },
    async freeDiskBytes() {
      return free;
    },
  };
}

function fakeDb(overrides: Partial<Record<string, string | number>> = {}): SeedVerifyDb {
  const kv: Record<string, string> = {
    schemaVersion: "4",
    "piiyaak:contentVersion": "41",
  };
  const counts: Record<string, number> = { words: 1, courses: 1, lessons: 1 };
  return {
    async integrityCheck() {
      return "ok";
    },
    async getKV(key: string) {
      if (key === "schemaVersion") return (overrides.schemaVersion as string) ?? kv[key]!;
      if (key === "piiyaak:contentVersion")
        return (overrides["piiyaak:contentVersion"] as string) ?? kv[key]!;
      return null;
    },
    async count(table: "words" | "courses" | "lessons") {
      const v = overrides[`count:${table}`];
      return typeof v === "number" ? v : counts[table]!;
    },
  };
}

const BASE = {
  tmpDir: "file:///tmp/seed-41/",
  manifest: MANIFEST,
  remote: "41",
  uncompressedBytes: 5000,
};

describe("verifySeedDir", () => {
  it("resuelve en verde con fakes coherentes", async () => {
    await expect(verifySeedDir({ ...BASE, fs: fakeFs(), db: fakeDb() })).resolves.toBeUndefined();
  });

  it("falla si falta un archivo o su size difiere (sin re-hash)", async () => {
    await expect(
      verifySeedDir({ ...BASE, fs: fakeFs({ [`file:///tmp/seed-41/media/${FILE_B}.png`]: 199 }), db: fakeDb() })
    ).rejects.toBeInstanceOf(SeedVerifyError);
    const fsMissing: SeedVerifyFs = {
      fileInfo: async () => ({ exists: false, size: null }),
      freeDiskBytes: async () => 10_000_000,
    };
    await expect(verifySeedDir({ ...BASE, fs: fsMissing, db: fakeDb() })).rejects.toThrow(
      /media/
    );
  });

  it("falla con espacio insuficiente (margen = descomprimido + dbBytes)", async () => {
    await expect(
      verifySeedDir({ ...BASE, fs: fakeFs({}, 100), db: fakeDb() })
    ).rejects.toThrow(/espacio/i);
  });

  it("falla si integrity_check no es ok", async () => {
    const db: SeedVerifyDb = { ...fakeDb(), integrityCheck: async () => "corrupt" };
    await expect(verifySeedDir({ ...BASE, fs: fakeFs(), db })).rejects.toThrow(/integrity/i);
  });

  it('falla si schemaVersion no es "4" (sin adoptar)', async () => {
    const db = fakeDb({ schemaVersion: "5" });
    await expect(verifySeedDir({ ...BASE, fs: fakeFs(), db })).rejects.toThrow(/schemaVersion/);
  });

  it("falla si la db trae otro contentVersion que el remoto", async () => {
    const db = fakeDb({ "piiyaak:contentVersion": "40" });
    await expect(verifySeedDir({ ...BASE, fs: fakeFs(), db })).rejects.toThrow(
      /contentVersion/
    );
  });

  it("falla si un COUNT difiere del manifiesto", async () => {
    const db = fakeDb({ "count:words": 7 });
    await expect(verifySeedDir({ ...BASE, fs: fakeFs(), db })).rejects.toThrow(/words/);
  });
});
