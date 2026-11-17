import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { seedMediaDest, seedMediaKind } from "./seed-media";

// El destino se decide por MIME, no por el prefijo del objectKey: ambos
// productores de seed (convención `illustrations/` del móvil y `images/`
// del generador web) deben terminar en assets/illustrations/.
describe("seedMediaKind", () => {
  it("mapea audio/* a audios", () => {
    expect(seedMediaKind("audio/mpeg")).toBe("audios");
    expect(seedMediaKind("audio/webm")).toBe("audios");
  });

  it("mapea image/* a illustrations", () => {
    expect(seedMediaKind("image/webp")).toBe("illustrations");
    expect(seedMediaKind("image/png")).toBe("illustrations");
  });

  it("lanza error con un mensaje claro ante un MIME desconocido", () => {
    expect(() => seedMediaKind("video/mp4")).toThrow(/tipo MIME no soportado/);
    expect(() => seedMediaKind("application/octet-stream")).toThrow(
      /tipo MIME no soportado/,
    );
  });
});

describe("seedMediaDest", () => {
  const assetsDir = join("ruta", "assets");
  const uuid = "003355fb-4dde-4832-8e2e-d4c39a18dceb";

  it("lleva illustrations/<uuid>.webp a assets/illustrations/<uuid>.webp", () => {
    expect(
      seedMediaDest(assetsDir, "image/webp", `illustrations/${uuid}.webp`),
    ).toBe(join(assetsDir, "illustrations", `${uuid}.webp`));
  });

  it("lleva images/<uuid>.webp (convención del generador web) a assets/illustrations/<uuid>.webp", () => {
    expect(
      seedMediaDest(assetsDir, "image/webp", `images/${uuid}.webp`),
    ).toBe(join(assetsDir, "illustrations", `${uuid}.webp`));
  });

  it("lleva audios/<base> a assets/audios/<base>", () => {
    expect(seedMediaDest(assetsDir, "audio/mpeg", "audios/hola.mp3")).toBe(
      join(assetsDir, "audios", "hola.mp3"),
    );
  });
});
