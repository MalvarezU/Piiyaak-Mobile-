import { describe, it, expect } from "vitest";
import { compareVersions } from "../version-gate";

/**
 * F0 — comparador solo-adelante (spec §1.3): igualdad sobre el string,
 * orden sobre parseInt validado. `remote < local` es no-op (D3, sin
 * downgrade); el warn estructurado lo emite el llamador (sync.ts, W3).
 */
describe("compareVersions", () => {
  it("remote == local → skip", () => {
    expect(compareVersions("41", "41")).toEqual({ action: "skip" });
  });

  it("remote > local → seed con remoto canónico", () => {
    expect(compareVersions("40", "41")).toEqual({ action: "seed", remote: "41" });
  });

  it("local ausente o inválido → seed (dispositivo desactualizado)", () => {
    expect(compareVersions(null, "41")).toEqual({ action: "seed", remote: "41" });
    expect(compareVersions("", "41")).toEqual({ action: "seed", remote: "41" });
    expect(compareVersions("x", "41")).toEqual({ action: "seed", remote: "41" });
  });

  it("remote < local → noop con reason, sin escrituras", () => {
    const move = compareVersions("42", "41");
    expect(move.action).toBe("noop");
    if (move.action === "noop") {
      expect(typeof move.reason).toBe("string");
      expect(move.reason.length).toBeGreaterThan(0);
    }
  });

  it("remote ilegible → throw, nunca seed con versión inválida", () => {
    expect(() => compareVersions("41", "x")).toThrow();
    expect(() => compareVersions("41", "")).toThrow();
  });
});
