import { describe, it, expect } from "vitest";
import {
  seedReducer,
  seedStatusCopy,
  formatSeedProgress,
  initialSeedState,
  type SeedState,
} from "../seed-machine";

/**
 * W3-03 — máquina de 6 estados de "Preparando contenido" (spec §4.2).
 * Copy neutral, sin hype. El componente RN se verifica por contrato
 * estático (entorno node sin render); la lógica vive acá y es pura.
 */
describe("seedReducer", () => {
  it("arranca en checking", () => {
    expect(initialSeedState).toEqual({ status: "checking" });
  });

  it("avanza checking → downloading → verifying → installing → ready", () => {
    let s: SeedState = initialSeedState;
    s = seedReducer(s, { type: "PROGRESS", receivedBytes: 10, totalBytes: 100 });
    expect(s).toEqual({
      status: "downloading",
      progress: { receivedBytes: 10, totalBytes: 100 },
    });
    s = seedReducer(s, { type: "VERIFY" });
    expect(s).toEqual({ status: "verifying" });
    s = seedReducer(s, { type: "INSTALL", phase: "copiando datos" });
    expect(s).toEqual({ status: "installing", phase: "copiando datos" });
    s = seedReducer(s, { type: "INSTALL", phase: "moviendo medios" });
    expect(s).toEqual({ status: "installing", phase: "moviendo medios" });
    s = seedReducer(s, { type: "DONE" });
    expect(s).toEqual({ status: "ready" });
  });

  it("FAIL desde cualquier estado no terminal va a error con reintento", () => {
    for (const from of [
      initialSeedState,
      { status: "downloading", progress: { receivedBytes: 1, totalBytes: 2 } },
      { status: "verifying" },
      { status: "installing", phase: "copiando datos" },
    ] as SeedState[]) {
      const s = seedReducer(from, { type: "FAIL", message: "red caída", canRetry: true });
      expect(s).toEqual({
        status: "error",
        message: "red caída",
        canRetry: true,
        textOnly: true,
      });
    }
  });

  it("RETRY vuelve a checking y el terminal ready ignora eventos", () => {
    const err: SeedState = { status: "error", message: "x", canRetry: true, textOnly: true };
    expect(seedReducer(err, { type: "RETRY" })).toEqual({ status: "checking" });
    const ready: SeedState = { status: "ready" };
    expect(seedReducer(ready, { type: "PROGRESS", receivedBytes: 1, totalBytes: 1 })).toEqual(
      ready
    );
  });
});

describe("seedStatusCopy", () => {
  it("usa el copy neutral exigido sin hype", () => {
    expect(seedStatusCopy({ status: "checking" }).title).toBe(
      "Comprobando versión del contenido…"
    );
    expect(
      seedStatusCopy({ status: "downloading", progress: { receivedBytes: 0, totalBytes: 0 } })
        .title
    ).toBe("Descargando contenido…");
    expect(seedStatusCopy({ status: "verifying" }).title).toBe("Verificando contenido…");
    expect(
      seedStatusCopy({ status: "installing", phase: "copiando datos" }).title
    ).toBe("Instalando contenido…");
    expect(
      seedStatusCopy({ status: "installing", phase: "moviendo medios" }).detail
    ).toBe("moviendo medios");
  });
});

describe("formatSeedProgress", () => {
  it('formatea "X de Y MB (N %)" con MB en decimal', () => {
    expect(formatSeedProgress(5_000_000, 20_000_000)).toBe("5.0 de 20.0 MB (25 %)");
    expect(formatSeedProgress(0, 0)).toBe("0.0 de 0.0 MB (0 %)");
    expect(formatSeedProgress(20_000_000, 20_000_000)).toBe("20.0 de 20.0 MB (100 %)");
  });
});
