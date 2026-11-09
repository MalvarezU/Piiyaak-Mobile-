import { describe, it, expect } from "vitest";
import { parseSeedManifest } from "../seed-manifest";

/**
 * W3-02 — esquema `manifest.json` (spec §2.6): formato exacto, tipos y
 * `format === "piiyaak-seed/1"`. Lector que aborta ante major distinto.
 */
const FILE_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FILE_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DB_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    format: "piiyaak-seed/1",
    contentVersion: "41",
    createdAt: "2026-01-01T00:00:00.000Z",
    dbSha256: DB_HASH,
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
    ...overrides,
  };
}

describe("parseSeedManifest", () => {
  it("acepta un manifiesto válido con tipos exactos", () => {
    const m = parseSeedManifest(validManifest());
    expect(m.contentVersion).toBe("41");
    expect(m.files).toHaveLength(2);
    expect(m.counts.mediaFiles).toBe(2);
  });

  it("rechaza format distinto (major incompatible aborta)", () => {
    expect(() => parseSeedManifest(validManifest({ format: "piiyaak-seed/2" }))).toThrow();
    expect(() => parseSeedManifest(validManifest({ format: "otro/1" }))).toThrow();
  });

  it("rechaza dbSha256 con mayúsculas o longitud inválida", () => {
    expect(() =>
      parseSeedManifest(validManifest({ dbSha256: DB_HASH.toUpperCase() }))
    ).toThrow();
    expect(() => parseSeedManifest(validManifest({ dbSha256: "abc" }))).toThrow();
  });

  it("rechaza sha256 de archivo con mayúsculas", () => {
    const bad = validManifest();
    bad.files = [
      {
        objectKey: "audios/a.mp3",
        sha256: FILE_A.toUpperCase(),
        size: 100,
        mimeType: "audio/mpeg",
        localPath: `media/${FILE_A}.mp3`,
      },
    ];
    bad.counts = { words: 1, courses: 0, modules: 0, lessons: 0, mediaFiles: 1 };
    bad.bytesTotal = 1100;
    bad.bytesAudio = 100;
    bad.bytesImage = 0;
    expect(() => parseSeedManifest(bad)).toThrow();
  });

  it("rechaza conteos negativos y contentVersion no canónica", () => {
    expect(() =>
      parseSeedManifest({
        ...validManifest(),
        counts: { words: -1, courses: 0, modules: 0, lessons: 0, mediaFiles: 0 },
      })
    ).toThrow();
    expect(() => parseSeedManifest(validManifest({ contentVersion: "41x" }))).toThrow();
    expect(() => parseSeedManifest(validManifest({ contentVersion: 41 }))).toThrow();
  });

  it("rechaza files desordenado o con objectKey duplicado", () => {
    const reversed = validManifest();
    reversed.files = [...reversed.files].reverse();
    expect(() => parseSeedManifest(reversed)).toThrow();
  });

  it("rechaza bytesTotal inconsistente con dbBytes + Σ sizes", () => {
    expect(() => parseSeedManifest(validManifest({ bytesTotal: 9999 }))).toThrow();
  });

  it("rechaza manifiesto corrupto (no-objeto, campos ausentes)", () => {
    for (const bad of [null, "texto", 42, {}, { format: "piiyaak-seed/1" }]) {
      expect(() => parseSeedManifest(bad)).toThrow();
    }
  });
});
