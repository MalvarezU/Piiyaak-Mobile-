import { describe, it, expect } from "vitest";
import { decideResume, type ResumeInput } from "./seed-resume";
import type { SeedDownloadRecord } from "./seed-download";

/**
 * W3.1 — decisión pura resume-vs-fresco (spec §W3.2, matriz normativa).
 * Sin imports `expo-*`: corre en Node.
 */
function rec(resumeData: string | null | undefined): SeedDownloadRecord {
  return {
    partName: "seed-41.zip.part",
    totalBytes: 1000,
    updatedAt: "2026-11-09T00:00:00.000Z",
    resumeData,
  };
}

function input(
  record: SeedDownloadRecord | null,
  existingBytes: number | null,
  supportsResume: boolean,
  resumedStatus: number | null
): ResumeInput {
  return { record, existingBytes, supportsResume, resumedStatus };
}
describe("decideResume — matriz §W3.2", () => {
  it("fila 1: record.resumeData nulo → fresh", () => {
    expect(
      decideResume({
        record: null,
        existingBytes: 500,
        supportsResume: true,
        resumedStatus: null,
      })
    ).toEqual({ action: "fresh" });
  });

  it("fila 2: existingBytes nulo/0/≥ total → fresh aunque haya resumeData", () => {
    const record = rec("opaco");
    for (const existingBytes of [null, 0, 1000, 1500]) {
      expect(
        decideResume({ record, existingBytes, supportsResume: true, resumedStatus: null })
      ).toEqual({ action: "fresh" });
    }
  });

  it("fila 3: supportsResume false → fresh aunque haya parcial", () => {
    expect(
      decideResume({
        record: rec("opaco"),
        existingBytes: 500,
        supportsResume: false,
        resumedStatus: null,
      })
    ).toEqual({ action: "fresh" });
  });

  it("fila 4: resume válido + supports true + status aún no intentado → resume", () => {
    expect(
      decideResume({
        record: rec("opaco"),
        existingBytes: 500,
        supportsResume: true,
        resumedStatus: null,
      })
    ).toEqual({ action: "resume" });
  });

  it("fila 5: resume válido + status 206 → resume (continuar)", () => {
    expect(
      decideResume({
        record: rec("opaco"),
        existingBytes: 500,
        supportsResume: true,
        resumedStatus: 206,
      })
    ).toEqual({ action: "resume" });
  });

  it("fila 6: resume válido + status distinto de 206 (200, etc.) → truncate-and-fresh", () => {
    for (const resumedStatus of [200, 201, 2060, 404, 416]) {
      expect(
        decideResume({
          record: rec("opaco"),
          existingBytes: 500,
          supportsResume: true,
          resumedStatus,
        })
      ).toEqual({ action: "truncate-and-fresh" });
    }
  });
});
