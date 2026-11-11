import { describe, it, expect } from "vitest";
import {
  swapSeedContent,
  SeedSwapError,
  SEED_USER_TABLES,
  seedCopySql,
  type SeedSwapDeps,
  type SeedSwapDb,
} from "../seed-swap";
import type { SeedManifest } from "../seed-manifest";

/**
 * W3-05 — swap atómico con preservación (spec §4.5, 8 pasos).
 * Deps inyectadas (expo-sqlite no existe en Node); el SQL exacto del
 * ATTACH se verifica por contrato estático. La db viva NO se toca
 * hasta el paso 5 (assert: ningún `moveFile` antes de verificar).
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
    {
      objectKey: "imagenes/b.png",
      sha256: FILE_B,
      size: 200,
      mimeType: "image/png",
      localPath: `media/${FILE_B}.png`,
    },
  ],
  counts: { words: 1, courses: 0, modules: 0, lessons: 0, mediaFiles: 2 },
  bytesTotal: 1000,
  bytesAudio: 300,
  bytesImage: 200,
};

const OPTS = {
  liveDbPath: "file:///doc/SQLite/piiyaak.db",
  tempDbPath: "file:///tmp/seed-41/piiyaak.db",
  tmpDir: "file:///tmp/seed-41/",
  baseDir: "file:///doc/",
  manifest: MANIFEST,
  remote: "41",
  serverTime: "2026-01-01T00:00:00.000Z",
  partUri: "file:///tmp/seed-41.zip.part",
  mediaUrls: [] as ReadonlyArray<{ url: string; kind: "audio" | "illustration" }>,
};

function fakeDb(overrides: Partial<SeedSwapDb> = {}): SeedSwapDb & {
  calls: string[];
  copied: string[];
} {
  const calls: string[] = [];
  const copied: string[] = [];
  return {
    calls,
    copied,
    async integrityCheck() {
      calls.push("integrity");
      return "ok";
    },
    async attachLive() {
      calls.push("attach");
    },
    async copyUserTable(table: string) {
      calls.push(`copy:${table}`);
      copied.push(table);
    },
    async countMain() {
      calls.push("countMain");
      return 5;
    },
    async countLive() {
      calls.push("countLive");
      return 5;
    },
    async detachLive() {
      calls.push("detach");
    },
    async close() {
      calls.push("close");
    },
    ...overrides,
  };
}

function fakeDeps(db: SeedSwapDb, overrides: Partial<SeedSwapDeps> = {}): SeedSwapDeps & {
  calls: string[];
  moves: Array<[string, string]>;
  copies: Array<[string, string]>;
  removed: string[];
} {
  const calls: string[] = [];
  const moves: Array<[string, string]> = [];
  const copies: Array<[string, string]> = [];
  const removed: string[] = [];
  return {
    calls,
    moves,
    copies,
    removed,
    async closeLive() {
      calls.push("closeLive");
    },
    async openTemp() {
      calls.push("openTemp");
      return db;
    },
    async moveFile(from: string, to: string) {
      calls.push(`move:${from}→${to}`);
      moves.push([from, to]);
    },
    async copyFile(from: string, to: string) {
      calls.push(`copy:${from}→${to}`);
      copies.push([from, to]);
    },
    async ensureDir(dirUri: string) {
      calls.push(`ensureDir:${dirUri}`);
    },
    async reopenLive() {
      calls.push("reopen");
    },
    async adoptVersion() {
      calls.push("adopt");
    },
    async removePath(uri: string) {
      calls.push(`remove:${uri}`);
      removed.push(uri);
    },
    async clearDownloadRecord() {
      calls.push("clearRecord");
    },
    ...overrides,
  };
}

describe("swapSeedContent", () => {
  it("el SQL del paso 3 copia exacta main ← live por tabla", () => {
    expect(seedCopySql("course_progress")).toBe(
      "INSERT OR REPLACE INTO main.course_progress SELECT * FROM live.course_progress;"
    );
    expect(seedCopySql("outbox")).toBe(
      "INSERT OR REPLACE INTO main.outbox SELECT * FROM live.outbox;"
    );
    expect(seedCopySql("history")).toBe(
      "INSERT OR REPLACE INTO main.history SELECT * FROM live.history;"
    );
  });

  it("preserva EXACTAMENTE course_progress/outbox/history y adopta la versión", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db);
    await swapSeedContent(deps, OPTS);
    expect(db.copied).toEqual(["course_progress", "outbox", "history"]);
    expect(SEED_USER_TABLES).toEqual(["course_progress", "outbox", "history"]);
    expect(deps.calls).toContain("adopt");
  });

  it("respeta el orden: verificar todo antes de mover la viva (paso 5)", async () => {
    const order: string[] = [];
    const db = fakeDb({
      attachLive: async () => void order.push("attach"),
      detachLive: async () => void order.push("detach"),
    });
    const deps = fakeDeps(db, {
      moveFile: async (from: string, to: string) => void order.push(`move:${from}→${to}`),
    });
    // Re-registrar moves para los asserts de contenido (el override no los guarda).
    const moves: Array<[string, string]> = [];
    const origMove = deps.moveFile;
    deps.moveFile = async (from: string, to: string) => {
      moves.push([from, to]);
      return origMove(from, to);
    };
    await swapSeedContent(deps, OPTS);
    const firstMove = order.findIndex((c) => c.startsWith("move:"));
    const detachAt = order.indexOf("detach");
    expect(firstMove).toBeGreaterThan(-1);
    expect(detachAt).toBeGreaterThan(-1);
    expect(detachAt).toBeLessThan(firstMove);
    expect(order.indexOf("attach")).toBeLessThan(detachAt);
    expect(moves[0]).toEqual([
      "file:///doc/SQLite/piiyaak.db",
      "file:///doc/SQLite/piiyaak.db.bak",
    ]);
    expect(moves[1]).toEqual([
      "file:///tmp/seed-41/piiyaak.db",
      "file:///doc/SQLite/piiyaak.db",
    ]);
  });

  it("sin URLs vigentes conserva el nombre por contenido (no se pierde)", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db);
    await swapSeedContent(deps, OPTS);
    expect(deps.moves).toContainEqual([
      `file:///tmp/seed-41/media/${FILE_A}.mp3`,
      `file:///doc/audios/${FILE_A}.mp3`,
    ]);
    expect(deps.moves).toContainEqual([
      `file:///tmp/seed-41/media/${FILE_B}.png`,
      `file:///doc/illustrations/${FILE_B}.png`,
    ]);
  });

  it("mueve medios con la clave url_<norm> que MediaCache resuelve y garantiza dirs", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db);
    await swapSeedContent(deps, {
      ...OPTS,
      mediaUrls: [
        { url: "https://cdn.example.com/audios/temp/x/a.mp3", kind: "audio" },
      ],
    });
    expect(deps.calls).toContain("ensureDir:file:///doc/audios/");
    expect(deps.calls).toContain("ensureDir:file:///doc/illustrations/");
    expect(deps.moves).toContainEqual([
      `file:///tmp/seed-41/media/${FILE_A}.mp3`,
      "file:///doc/audios/url_https___cdn_example_com_audios_temp_x_a_mp3.mp3",
    ]);
  });

  it("el mismo contenido servido por varias URLs se copia por URL (move + copies)", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db);
    await swapSeedContent(deps, {
      ...OPTS,
      mediaUrls: [
        { url: "https://cdn.example.com/uno/a.mp3", kind: "audio" },
        { url: "https://cdn.example.com/dos/a.mp3", kind: "audio" },
      ],
    });
    expect(deps.moves).toContainEqual([
      `file:///tmp/seed-41/media/${FILE_A}.mp3`,
      "file:///doc/audios/url_https___cdn_example_com_uno_a_mp3.mp3",
    ]);
    expect(deps.copies).toEqual([
      [
        "file:///doc/audios/url_https___cdn_example_com_uno_a_mp3.mp3",
        "file:///doc/audios/url_https___cdn_example_com_dos_a_mp3.mp3",
      ],
    ]);
  });

  it("limpia tmp, .part, registro y .bak solo tras éxito", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db);
    await swapSeedContent(deps, OPTS);
    const lastMoves = deps.calls.filter((c) => c.startsWith("remove:") || c === "clearRecord");
    expect(lastMoves).toEqual([
      "remove:file:///tmp/seed-41/",
      "remove:file:///tmp/seed-41.zip.part",
      "clearRecord",
      "remove:file:///doc/SQLite/piiyaak.db.bak",
    ]);
  });

  it("integrity_check fallido aborta antes del paso 5, viva intacta", async () => {
    const db = fakeDb({ integrityCheck: async () => "*** corrupt ***" });
    const deps = fakeDeps(db);
    await expect(swapSeedContent(deps, OPTS)).rejects.toBeInstanceOf(SeedSwapError);
    expect(deps.moves).toEqual([]);
    expect(db.calls).toContain("close");
  });

  it("conteo divergente aborta con DETACH y sin tocar la viva", async () => {
    const db = fakeDb({
      countMain: async () => 5,
      countLive: async () => 4,
    });
    const deps = fakeDeps(db);
    await expect(swapSeedContent(deps, OPTS)).rejects.toThrow(/conteo/);
    expect(db.calls).toContain("detach");
    expect(deps.moves).toEqual([]);
  });

  it("reapertura fallida restaura el .bak y reporta viva restaurada", async () => {
    const db = fakeDb();
    const deps = fakeDeps(db, {
      reopenLive: async () => {
        throw new Error("open failed");
      },
    });
    const err = await swapSeedContent(deps, OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeedSwapError);
    expect((err as SeedSwapError).liveRestored).toBe(true);
    expect(deps.moves).toContainEqual([
      "file:///doc/SQLite/piiyaak.db.bak",
      "file:///doc/SQLite/piiyaak.db",
    ]);
  });
});
