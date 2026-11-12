import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seams de espía sobre el mock en memoria de `expo-file-system`
 * (`src/db/__mocks__/expo-file-system`):
 *
 * - `calls`: cuenta las mutaciones (makeDirectoryAsync/copyAsync/deleteAsync)
 *   para poder afirmar que una operación **no** repeats cuando el estado ya
 *   está listo.
 * - `entries`: fuerza lo que devuelve `readDirectoryAsync`. El mock base solo
 *   puede devolver nombres desnudos; la frontera real puede devolver rutas
 *   completas o URIs con esquema (`://`), y esa normalización hay que
 *   verificarla.
 */
const fsHooks = vi.hoisted(() => ({
  entries: null as string[] | null,
  calls: { makeDir: 0, copy: 0, delete: 0 },
}));

vi.mock("expo-file-system", async () => import("./__mocks__/expo-file-system"));
vi.mock("expo-file-system/legacy", async () => {
  const base = await import("./__mocks__/expo-file-system");
  return {
    ...base,
    async readDirectoryAsync(uri: string): Promise<string[]> {
      if (fsHooks.entries) return fsHooks.entries;
      return base.readDirectoryAsync(uri);
    },
    async makeDirectoryAsync(
      uri: string,
      options?: { intermediates?: boolean }
    ): Promise<void> {
      fsHooks.calls.makeDir++;
      return base.makeDirectoryAsync(uri, options);
    },
    async copyAsync(options: { from: string; to: string }): Promise<void> {
      fsHooks.calls.copy++;
      return base.copyAsync(options);
    },
    async deleteAsync(
      uri: string,
      options?: { idempotent?: boolean }
    ): Promise<void> {
      fsHooks.calls.delete++;
      return base.deleteAsync(uri, options);
    },
  };
});

import * as FileSystem from "expo-file-system/legacy";
import {
  __reset,
  __listAll,
  __seedFile,
  __failNextDownloads,
} from "./__mocks__/expo-file-system";
import { expoMediaStore, defaultMediaCache, resolveCachedUri } from "./media-fs";
import type { MediaRef } from "./media-cache";

const BASE = "file:///mock-doc/";

function ref(overrides: Partial<MediaRef> = {}): MediaRef {
  return {
    wordId: "w1",
    kind: "illustration",
    url: "https://cdn.example.com/img/agua.png",
    sha256: null,
    ...overrides,
  };
}

beforeEach(() => {
  __reset();
  fsHooks.entries = null;
  fsHooks.calls = { makeDir: 0, copy: 0, delete: 0 };
});

/**
 * `expoMediaStore` es la frontera nativa del media-cache: traduce las
 * operaciones del cache a la API de `expo-file-system/legacy`.
 */
describe("expoMediaStore (frontera nativa)", () => {
  it("getInfo informa existencia real del archivo", async () => {
    const store = expoMediaStore();
    expect(await store.getInfo(`${BASE}illustrations/a.png`)).toEqual({
      exists: false,
    });
    __seedFile(`${BASE}illustrations/a.png`, "bytes");
    expect(await store.getInfo(`${BASE}illustrations/a.png`)).toEqual({
      exists: true,
    });
  });

  it("getInfo de un directorio existente informa que existe", async () => {
    const store = expoMediaStore();
    // El mock considera existente un directorio cuando hay algo debajo.
    __seedFile(`${BASE}illustrations/a.png`, "bytes");
    expect(await store.getInfo(`${BASE}illustrations/`)).toEqual({
      exists: true,
    });
  });

  it("makeDir crea el directorio cuando no existe", async () => {
    const store = expoMediaStore();
    const dir = `${BASE}illustrations/`;
    expect((await FileSystem.getInfoAsync(dir)).exists).toBe(false);
    await store.makeDir(dir);
    expect((await FileSystem.getInfoAsync(dir)).exists).toBe(true);
    expect(fsHooks.calls.makeDir).toBe(1);
  });

  it("makeDir no recrea un directorio que ya existe", async () => {
    const store = expoMediaStore();
    const dir = `${BASE}illustrations/`;
    await store.makeDir(dir);
    const callsAfterFirst = fsHooks.calls.makeDir;
    await store.makeDir(dir);
    // La segunda llamada es un no-op: el directorio ya está.
    expect(fsHooks.calls.makeDir).toBe(callsAfterFirst);
    expect((await FileSystem.getInfoAsync(dir)).exists).toBe(true);
  });

  it("download escribe el archivo y devuelve su uri", async () => {
    const store = expoMediaStore();
    const dest = `${BASE}illustrations/a.png`;
    const res = await store.download("https://cdn.example.com/a.png", dest);
    expect(res).toEqual({ uri: dest });
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
    expect(__listAll()).toContain(dest);
  });

  it("download propaga el error de red sin dejar archivo parcial", async () => {
    const store = expoMediaStore();
    const dest = `${BASE}illustrations/caida.png`;
    __failNextDownloads("https://cdn.example.com/caida.png", 1);
    await expect(
      store.download("https://cdn.example.com/caida.png", dest)
    ).rejects.toThrow(/network failure/);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
  });

  it("remove borra el archivo del cache", async () => {
    const store = expoMediaStore();
    const dest = `${BASE}illustrations/a.png`;
    __seedFile(dest, "bytes");
    await store.remove(dest);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(false);
    expect(fsHooks.calls.delete).toBe(1);
  });

  it("remove de un uri inexistente es idempotente: no lanza", async () => {
    const store = expoMediaStore();
    await expect(
      store.remove(`${BASE}illustrations/nunca-existio.png`)
    ).resolves.toBeUndefined();
  });

  it("listDir normaliza los nombres a URIs completas del directorio", async () => {
    const store = expoMediaStore();
    __seedFile(`${BASE}illustrations/a.png`, "bytes");
    __seedFile(`${BASE}illustrations/b.png`, "bytes");
    // Sin barra final: el prefijo se arma igual.
    expect(await store.listDir(`${BASE}illustrations`)).toEqual([
      `${BASE}illustrations/a.png`,
      `${BASE}illustrations/b.png`,
    ]);
    // Con barra final: mismo resultado.
    expect(await store.listDir(`${BASE}illustrations/`)).toEqual([
      `${BASE}illustrations/a.png`,
      `${BASE}illustrations/b.png`,
    ]);
  });

  it("listDir conserva las entradas que ya vienen normalizadas", async () => {
    const store = expoMediaStore();
    // La API real puede devolver nombres o rutas completas según plataforma.
    fsHooks.entries = [
      `${BASE}illustrations/a.png`,
      "https://cdn.example.com/b.png",
      "c.png",
    ];
    expect(await store.listDir(`${BASE}illustrations/`)).toEqual([
      `${BASE}illustrations/a.png`,
      "https://cdn.example.com/b.png",
      `${BASE}illustrations/c.png`,
    ]);
  });

  it("listDir de un directorio vacío devuelve una lista vacía", async () => {
    const store = expoMediaStore();
    expect(await store.listDir(`${BASE}audios/`)).toEqual([]);
  });

  it("copy duplica los bytes del origen en el destino", async () => {
    const store = expoMediaStore();
    const from = `${BASE}illustrations/a.png`;
    const to = `${BASE}illustrations/copia.png`;
    __seedFile(from, "bytes");
    await store.copy(from, to);
    expect((await FileSystem.getInfoAsync(to)).exists).toBe(true);
    expect(fsHooks.calls.copy).toBe(1);
  });

  it("copy de un origen inexistente propaga el error de I/O", async () => {
    const store = expoMediaStore();
    await expect(
      store.copy(`${BASE}illustrations/no-existe.png`, `${BASE}illustrations/x.png`)
    ).rejects.toThrow(/copy source not found/);
  });
});

/**
 * `defaultMediaCache` es el singleton que comparte toda la app: su base es
 * `documentDirectory` y el cache de medios debe ser el mismo en cada llamada.
 */
describe("defaultMediaCache (singleton de la app)", () => {
  it("devuelve siempre la misma instancia", () => {
    expect(defaultMediaCache()).toBe(defaultMediaCache());
  });

  it("usa documentDirectory como base del cache", () => {
    const cache = defaultMediaCache();
    expect(cache.localUriFor(ref())).toBe(
      `${BASE}illustrations/url_https___cdn_example_com_img_agua_png.png`
    );
  });

  it("cae a file:///piiyaak-media/ cuando no hay documentDirectory", async () => {
    vi.resetModules();
    vi.doMock("expo-file-system/legacy", async () => {
      const base = await import("./__mocks__/expo-file-system");
      return { ...base, documentDirectory: null };
    });
    try {
      const mod = await import("./media-fs");
      const cache = mod.defaultMediaCache();
      expect(cache.localUriFor(ref()).startsWith("file:///piiyaak-media/")).toBe(
        true
      );
    } finally {
      vi.doUnmock("expo-file-system/legacy");
      vi.resetModules();
    }
  });
});

/**
 * `resolveCachedUri` decide entre la copia local y la URL remota para medios
 * sin pasado heredado (bloques de lección, portadas de curso).
 */
describe("resolveCachedUri", () => {
  it("devuelve la uri local cuando el medio ya está cacheado", async () => {
    const cache = defaultMediaCache();
    const r = ref();
    const local = cache.localUriFor(r);
    __seedFile(local, "bytes");
    expect(await resolveCachedUri(r)).toBe(local);
  });

  it("devuelve la url remota cuando el medio no está cacheado", async () => {
    const r = ref({ wordId: "w9" });
    expect(await resolveCachedUri(r)).toBe(r.url);
  });
});
