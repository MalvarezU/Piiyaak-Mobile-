import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Seams de espía sobre el mock en memoria de `expo-file-system`:
 * permiten forzar el fallo de `copyAsync`/`deleteAsync` (errores de I/O que
 * la implementación absorbe) y contar las mutaciones.
 */
const fsHooks = vi.hoisted(() => ({
  failCopy: false,
  failDelete: false,
  calls: { makeDir: 0, copy: 0, delete: 0 },
}));

vi.mock("expo-file-system", async () => import("./db/__mocks__/expo-file-system"));
vi.mock("expo-file-system/legacy", async () => {
  const base = await import("./db/__mocks__/expo-file-system");
  return {
    ...base,
    async makeDirectoryAsync(
      uri: string,
      options?: { intermediates?: boolean }
    ): Promise<void> {
      fsHooks.calls.makeDir++;
      return base.makeDirectoryAsync(uri, options);
    },
    async copyAsync(options: { from: string; to: string }): Promise<void> {
      fsHooks.calls.copy++;
      if (fsHooks.failCopy) throw new Error("mock copy failure");
      return base.copyAsync(options);
    },
    async deleteAsync(
      uri: string,
      options?: { idempotent?: boolean }
    ): Promise<void> {
      fsHooks.calls.delete++;
      if (fsHooks.failDelete) throw new Error("mock delete failure");
      return base.deleteAsync(uri, options);
    },
  };
});

/**
 * `expo-asset` real no puede resolver módulos en Node: se reemplaza por un
 * doble que devuelve una URI local controlable.
 */
const assetHooks = vi.hoisted(() => ({ fromModule: vi.fn() }));
vi.mock("expo-asset", () => ({
  Asset: {
    fromModule: (...args: unknown[]) => assetHooks.fromModule(...args),
  },
}));

/**
 * El mapa generado real queda vacío en Vitest (`require` no existe en ESM),
 * así que se inyecta un mapa con dos assets para ejercitar el puente offline.
 */
vi.mock("./bundled-media.generated", () => ({
  BUNDLED_AUDIOS: {},
  BUNDLED_ILLUSTRATIONS: {
    "illustrations/tupa.png": 101,
    "illustrations/OTRO.webp": 102,
  },
}));

import * as FileSystem from "expo-file-system/legacy";
import { __reset, __seedFile, __listAll } from "./db/__mocks__/expo-file-system";
import { defaultMediaCache } from "./db/media-fs";
import {
  resolveBundledIllustrationUri,
  resolveIllustrationUri,
  downloadIllustration,
  downloadWordIllustration,
  removeIllustration,
  removeWordIllustration,
  illustrationExists,
  localIllustrationPath,
  ensureIllustrationDir,
} from "./illustrations";

const BASE = "file:///mock-doc/";
const SHA_A = "a".repeat(64);
const URL_IMG = "https://cdn.example.com/img/agua.png";

/** Asset local por defecto: sin `localUri`, solo `uri`. */
function stubAsset(localUri: string | null = null, uri = "asset://bundled/101") {
  assetHooks.fromModule.mockImplementation(() => ({
    localUri,
    uri,
    downloadAsync: async () => {},
  }));
}

beforeEach(() => {
  __reset();
  fsHooks.failCopy = false;
  fsHooks.failDelete = false;
  fsHooks.calls = { makeDir: 0, copy: 0, delete: 0 };
  assetHooks.fromModule.mockReset();
  stubAsset();
});

/**
 * `resolveBundledIllustrationUri`: puente offline. El servidor sirve URLs
 * remotas con nombres significativos y el APK trae los assets.
 */
describe("resolveBundledIllustrationUri (puente offline)", () => {
  it("resuelve el asset empaquetado por coincidencia exacta de ruta", async () => {
    stubAsset("file:///local/tupa.png", "asset://bundled/101");
    const uri = await resolveBundledIllustrationUri("illustrations/tupa.png");
    expect(uri).toBe("file:///local/tupa.png");
    expect(assetHooks.fromModule).toHaveBeenCalledWith(101);
  });

  it("resuelve por nombre de archivo ignorando mayúsculas y query", async () => {
    stubAsset("file:///local/tupa.png", "asset://bundled/101");
    const uri = await resolveBundledIllustrationUri(
      "https://cdn.example.com/illustrations/TUPA.PNG?v=2"
    );
    expect(uri).toBe("file:///local/tupa.png");
    expect(assetHooks.fromModule).toHaveBeenCalledWith(101);
  });

  it("devuelve null cuando la url no corresponde a ningún asset", async () => {
    const uri = await resolveBundledIllustrationUri(
      "https://cdn.example.com/illustrations/desconocida.png"
    );
    expect(uri).toBeNull();
    expect(assetHooks.fromModule).not.toHaveBeenCalled();
  });

  it("devuelve null cuando la url no tiene nombre de archivo", async () => {
    const uri = await resolveBundledIllustrationUri("https://cdn.example.com/");
    expect(uri).toBeNull();
    expect(assetHooks.fromModule).not.toHaveBeenCalled();
  });

  it("usa el uri remoto cuando el asset no expone localUri", async () => {
    stubAsset(null, "asset://bundled/101");
    const uri = await resolveBundledIllustrationUri("illustrations/tupa.png");
    expect(uri).toBe("asset://bundled/101");
  });

  it("devuelve null cuando el asset no expone ninguna uri", async () => {
    assetHooks.fromModule.mockImplementation(() => ({
      localUri: null,
      uri: null,
      downloadAsync: async () => {},
    }));
    const uri = await resolveBundledIllustrationUri("illustrations/tupa.png");
    expect(uri).toBeNull();
  });

  it("devuelve null si la descarga del asset falla", async () => {
    assetHooks.fromModule.mockImplementation(() => ({
      localUri: "file:///local/tupa.png",
      uri: "asset://bundled/101",
      downloadAsync: async () => {
        throw new Error("asset download failed");
      },
    }));
    const uri = await resolveBundledIllustrationUri("illustrations/tupa.png");
    expect(uri).toBeNull();
  });
});

/**
 * `resolveIllustrationUri`: doble lookup (contenido → URL normalizada →
 * heredado → bundled → remota) con migración perezosa en background.
 */
describe("resolveIllustrationUri (doble lookup)", () => {
  it("gana el cache por contenido cuando el sha256 está cacheado", async () => {
    const cache = defaultMediaCache();
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: SHA_A,
    });
    __seedFile(content, "bytes");
    const uri = await resolveIllustrationUri({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect(uri).toBe(content);
  });

  it("sin sha256 resuelve por URL normalizada (misma clave que el fallback)", async () => {
    const cache = defaultMediaCache();
    const fallback = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: null,
    });
    __seedFile(fallback, "bytes");
    const uri = await resolveIllustrationUri({ id: "w1", illustrationUrl: URL_IMG });
    expect(uri).toBe(fallback);
    // Sin sha no hay ruta por contenido que migrar: la clave por URL es la
    // misma que usaría el fallback.
    expect(
      cache.localUriFor({
        wordId: "w1",
        kind: "illustration",
        url: URL_IMG,
        sha256: SHA_A,
      })
    ).not.toBe(fallback);
    expect(fsHooks.calls.copy).toBe(0);
  });

  it("con sha256 cae a la URL normalizada y migra al nombre por contenido", async () => {
    const cache = defaultMediaCache();
    const fallback = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: null,
    });
    __seedFile(fallback, "bytes");
    const uri = await resolveIllustrationUri({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect(uri).toBe(fallback);
    await new Promise((r) => setTimeout(r, 10));
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: SHA_A,
    });
    expect((await FileSystem.getInfoAsync(content)).exists).toBe(true);
    // Nunca se escribe en la ruta heredada.
    expect(__listAll()).not.toContain(localIllustrationPath("w1", URL_IMG));
  });

  it("resuelve la ruta heredada por wordId cuando no hay cache", async () => {
    const legacy = localIllustrationPath("w1", URL_IMG);
    __seedFile(legacy, "legacy-bytes");
    const uri = await resolveIllustrationUri({ id: "w1", illustrationUrl: URL_IMG });
    expect(uri).toBe(legacy);
    // La migración deja el archivo por contenido y la heredada intacta.
    await new Promise((r) => setTimeout(r, 10));
    const cache = defaultMediaCache();
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: null,
    });
    expect((await FileSystem.getInfoAsync(content)).exists).toBe(true);
    expect((await FileSystem.getInfoAsync(legacy)).exists).toBe(true);
  });

  it("con sha256 sin cache ni fallback por URL cae a la ruta heredada", async () => {
    const legacy = localIllustrationPath("w1", URL_IMG);
    __seedFile(legacy, "legacy-bytes");
    const uri = await resolveIllustrationUri({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect(uri).toBe(legacy);
    // La migración perezosa copia la heredada a la ruta por contenido.
    await new Promise((r) => setTimeout(r, 10));
    const cache = defaultMediaCache();
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: SHA_A,
    });
    expect((await FileSystem.getInfoAsync(content)).exists).toBe(true);
  });

  it("con sha256 y sin nada local devuelve la url remota", async () => {
    const uri = await resolveIllustrationUri({
      id: "w9",
      illustrationUrl: "https://cdn.example.com/img/nueva.png",
      illustrationSha256: SHA_A,
    });
    expect(uri).toBe("https://cdn.example.com/img/nueva.png");
  });

  it("resuelve el asset empaquetado cuando no hay cache ni heredado", async () => {
    stubAsset("file:///local/tupa.png", "asset://bundled/101");
    const uri = await resolveIllustrationUri({
      id: "w1",
      illustrationUrl: "https://cdn.example.com/illustrations/Tupa.png",
    });
    expect(uri).toBe("file:///local/tupa.png");
  });

  it("devuelve la url remota cuando no hay nada local", async () => {
    const uri = await resolveIllustrationUri({
      id: "w9",
      illustrationUrl: "https://cdn.example.com/img/nueva.png",
    });
    expect(uri).toBe("https://cdn.example.com/img/nueva.png");
  });
});

/**
 * Descarga: el adapter prioriza el cache por contenido y usa la ruta
 * heredada como puente antes de bajar de la red.
 */
describe("downloadWordIllustration", () => {
  it("descarga por la clave de contenido cuando hay sha256", async () => {
    const dest = await downloadWordIllustration({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect(dest).toBe(`${BASE}illustrations/${SHA_A}.png`);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
  });

  it("reutiliza el archivo ya cacheado sin volver a descargar", async () => {
    const first = await downloadWordIllustration({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    const second = await downloadWordIllustration({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect(second).toBe(first);
  });

  it("migra la ruta heredada al cache por contenido sin tocar la red", async () => {
    const legacy = localIllustrationPath("w1", URL_IMG);
    __seedFile(legacy, "legacy-bytes");
    const dest = await downloadWordIllustration({ id: "w1", illustrationUrl: URL_IMG });
    expect(dest.startsWith(`${BASE}illustrations/url_`)).toBe(true);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
    // La copia conserva los bytes de la heredada.
    expect(fsHooks.calls.copy).toBe(1);
    expect((await FileSystem.getInfoAsync(legacy)).exists).toBe(true);
  });

  it("si la copia de la heredada falla cae a la descarga remota", async () => {
    const legacy = localIllustrationPath("w1", URL_IMG);
    __seedFile(legacy, "legacy-bytes");
    fsHooks.failCopy = true;
    const dest = await downloadWordIllustration({ id: "w1", illustrationUrl: URL_IMG });
    expect(dest.startsWith(`${BASE}illustrations/url_`)).toBe(true);
    expect((await FileSystem.getInfoAsync(dest)).exists).toBe(true);
  });

  it("downloadIllustration delega en la misma descarga por URL normalizada", async () => {
    const dest = await downloadIllustration("w1", URL_IMG);
    expect(dest.startsWith(`${BASE}illustrations/url_`)).toBe(true);
    expect(await illustrationExists("w1", URL_IMG)).toBe(true);
  });
});

/**
 * `ensureIllustrationDir` deja el directorio de ilustraciones listo.
 */
describe("ensureIllustrationDir", () => {
  it("crea el directorio de ilustraciones cuando falta", async () => {
    await ensureIllustrationDir();
    expect((await FileSystem.getInfoAsync(`${BASE}illustrations/`)).exists).toBe(
      true
    );
    expect(fsHooks.calls.makeDir).toBe(1);
  });

  it("no recrea el directorio cuando ya existe", async () => {
    await ensureIllustrationDir();
    const callsAfterFirst = fsHooks.calls.makeDir;
    await ensureIllustrationDir();
    expect(fsHooks.calls.makeDir).toBe(callsAfterFirst);
  });
});

/**
 * Borrado: `removeIllustration` limpia cache y heredado;
 * `removeWordIllustration` además borra la ruta por contenido.
 */
describe("removeIllustration / removeWordIllustration", () => {
  it("removeIllustration borra la ruta por URL y la heredada", async () => {
    const cache = defaultMediaCache();
    const fallback = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: null,
    });
    const legacy = localIllustrationPath("w1", URL_IMG);
    __seedFile(fallback, "bytes");
    __seedFile(legacy, "bytes");
    await removeIllustration("w1", URL_IMG);
    expect((await FileSystem.getInfoAsync(fallback)).exists).toBe(false);
    expect((await FileSystem.getInfoAsync(legacy)).exists).toBe(false);
  });

  it("removeWordIllustration borra también la ruta por contenido", async () => {
    const cache = defaultMediaCache();
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: SHA_A,
    });
    __seedFile(content, "bytes");
    await removeWordIllustration({
      id: "w1",
      illustrationUrl: URL_IMG,
      illustrationSha256: SHA_A,
    });
    expect((await FileSystem.getInfoAsync(content)).exists).toBe(false);
  });

  it("un error de I/O al borrar no propaga (borrado best-effort)", async () => {
    const cache = defaultMediaCache();
    const fallback = cache.localUriFor({
      wordId: "w1",
      kind: "illustration",
      url: URL_IMG,
      sha256: null,
    });
    __seedFile(fallback, "bytes");
    fsHooks.failDelete = true;
    await expect(removeIllustration("w1", URL_IMG)).resolves.toBeUndefined();
    await expect(
      removeWordIllustration({
        id: "w1",
        illustrationUrl: URL_IMG,
        illustrationSha256: SHA_A,
      })
    ).resolves.toBeUndefined();
    // El archivo sobrevive: el borrado es best-effort.
    expect((await FileSystem.getInfoAsync(fallback)).exists).toBe(true);
  });
});

/**
 * `illustrationExists` consulta el cache por URL y la ruta heredada.
 */
describe("illustrationExists", () => {
  it("da true cuando el medio está en el cache por URL", async () => {
    await downloadIllustration("w1", URL_IMG);
    expect(await illustrationExists("w1", URL_IMG)).toBe(true);
  });

  it("da true cuando solo existe la ruta heredada", async () => {
    __seedFile(localIllustrationPath("w1", URL_IMG), "legacy-bytes");
    expect(await illustrationExists("w1", URL_IMG)).toBe(true);
  });

  it("da false cuando no existe en ningún lado", async () => {
    expect(await illustrationExists("w9", URL_IMG)).toBe(false);
  });
});
