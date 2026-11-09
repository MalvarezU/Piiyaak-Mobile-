import { describe, it, expect, vi } from "vitest";
import { unzipSeed, type SeedUnzipApi } from "../seed-unzip";

/**
 * W3-01 — envoltorio delgado sobre `react-native-zip-archive` v9.
 * El módulo nativo no existe en Node: la API se inyecta y este test
 * verifica delegación, progreso y limpieza de la suscripción.
 */
function fakeApi(events: number[] = [0.25, 1]): SeedUnzipApi & {
  removed: { count: number };
} {
  const removed = { count: 0 };
  return {
    removed,
    async getUncompressedSize() {
      return 10;
    },
    async unzip(_source: string, target: string) {
      return target;
    },
    subscribe(listener: (e: { progress: number; filePath: string }) => void) {
      for (const progress of events) listener({ progress, filePath: "piiyaak.db" });
      return { remove: () => void removed.count++ };
    },
  };
}

describe("unzipSeed", () => {
  it("descomprime en el destino y reenvía el progreso 0…1", async () => {
    const api = fakeApi([0.25, 0.5, 1]);
    const seen: number[] = [];
    const out = await unzipSeed(api, "file:///seed-41.zip", "file:///tmp/seed-41/", (p) =>
      seen.push(p)
    );
    expect(out).toBe("file:///tmp/seed-41/");
    expect(seen).toEqual([0.25, 0.5, 1]);
  });

  it("libera la suscripción de progreso al terminar", async () => {
    const api = fakeApi();
    await unzipSeed(api, "file:///seed-41.zip", "file:///tmp/seed-41/");
    expect(api.removed.count).toBe(1);
  });

  it("propaga el fallo del unzip nativo sin tragar el error", async () => {
    const api = fakeApi();
    const failing: SeedUnzipApi = {
      ...api,
      unzip: async () => {
        throw Object.assign(new Error("corrupt"), { code: "ERR_CORRUPT" });
      },
    };
    await expect(unzipSeed(failing, "file:///seed-41.zip", "file:///tmp/")).rejects.toThrow(
      "corrupt"
    );
    expect(api.removed.count).toBe(1);
  });

  it("rechaza rutas de destino fuera del temporal (ZipSlip defensivo)", async () => {
    const api = fakeApi();
    const spy = vi.spyOn(api, "unzip");
    await expect(unzipSeed(api, "file:///seed-41.zip", "")).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
