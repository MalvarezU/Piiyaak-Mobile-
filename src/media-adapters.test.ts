import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-file-system", () => import("./db/__mocks__/expo-file-system"));

import * as FileSystem from "expo-file-system";
import {
  __reset,
  __seedFile,
  __failNextDownloads,
} from "./db/__mocks__/expo-file-system";
import {
  downloadAudio,
  audioExists,
  removeAudio,
  resolveAudioUri,
  downloadWordAudio,
  removeWordAudio,
  localAudioPath,
} from "./audio";
import {
  downloadIllustration,
  illustrationExists,
  removeIllustration,
  resolveIllustrationUri,
  downloadWordIllustration,
  localIllustrationPath,
} from "./illustrations";

const SHA_A = "a".repeat(64);

beforeEach(() => {
  __reset();
});

/**
 * B3-03 (CA5): adaptadores de palabra delegan en MediaCache con doble
 * lookup (contenido → heredado → remoto) y migración perezosa.
 * Firmas públicas de `audio.ts` / `illustrations.ts` sin cambios.
 */
describe("adaptador de audio por contenido (B3-03)", () => {
  it("downloadAudio usa la clave por contenido y no re-descarga", async () => {
    const dest = await downloadAudio(
      "w1",
      "https://cdn.example.com/a.mp3?token=x"
    );
    expect(dest.startsWith(`${FileSystem.documentDirectory}audios/url_`)).toBe(
      true
    );
    expect(dest.endsWith(".mp3")).toBe(true);
    expect(await audioExists("w1", "https://cdn.example.com/a.mp3?token=x")).toBe(
      true
    );
    const second = await downloadAudio(
      "w1",
      "https://cdn.example.com/a.mp3?token=x"
    );
    expect(second).toBe(dest);
  });

  it("doble lookup: heredado por wordId resuelve y migra perezosamente", async () => {
    const legacy = localAudioPath("w1", "https://cdn.example.com/a.mp3");
    __seedFile(legacy, "legacy-bytes");
    // Sin sha conocido (firma sin cambios): resuelve el heredado.
    const uri = await resolveAudioUri({
      id: "w1",
      audioUrl: "https://cdn.example.com/a.mp3",
    });
    expect(uri).toBe(legacy);
    // La migración perezosa corre en background: le damos un tick y el
    // archivo por contenido (clave fallback) ya existe.
    await new Promise((r) => setTimeout(r, 10));
    const { defaultMediaCache } = await import("./db/media-fs");
    const cache = defaultMediaCache();
    const fallbackContent = cache.localUriFor({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/a.mp3",
      sha256: null,
    });
    expect((await FileSystem.getInfoAsync(fallbackContent)).exists).toBe(true);

    // Con sha (fila con F1-a): el contenido (ya migrado) gana al heredado
    // y programa la migración a la clave por hash, también en background.
    const ref = {
      id: "w1",
      audioUrl: "https://cdn.example.com/a.mp3",
      audioSha256: SHA_A,
    };
    expect(await resolveAudioUri(ref)).toBe(fallbackContent);
    await new Promise((r) => setTimeout(r, 10));
    const content = cache.localUriFor({
      wordId: "w1",
      kind: "audio",
      url: "https://cdn.example.com/a.mp3",
      sha256: SHA_A,
    });
    expect((await FileSystem.getInfoAsync(content)).exists).toBe(true);
    // …y ahora el contenido por hash gana a todo lo demás.
    expect(await resolveAudioUri(ref)).toBe(content);
    // Nunca se escribe en la ruta heredada: sigue con los bytes originales.
    const { __listAll } = await import("./db/__mocks__/expo-file-system");
    expect(__listAll()).toContain(legacy);
  });

  it("sin cache ni heredado resuelve la URL remota", async () => {
    const uri = await resolveAudioUri({
      id: "w9",
      audioUrl: "https://cdn.example.com/nuevo.mp3",
    });
    expect(uri).toBe("https://cdn.example.com/nuevo.mp3");
  });

  it("downloadWordAudio con sha usa la clave por hash", async () => {
    const dest = await downloadWordAudio({
      id: "w1",
      audioUrl: "https://cdn.example.com/a.mp3",
      audioSha256: SHA_A,
    });
    expect(dest).toBe(
      `${FileSystem.documentDirectory}audios/${SHA_A}.mp3`
    );
  });

  it("removeAudio y removeWordAudio borran contenido y heredado", async () => {
    const url = "https://cdn.example.com/a.mp3";
    __seedFile(localAudioPath("w1", url), "legacy");
    await downloadWordAudio({ id: "w1", audioUrl: url, audioSha256: SHA_A });
    await removeWordAudio({ id: "w1", audioUrl: url, audioSha256: SHA_A });
    expect(await audioExists("w1", url)).toBe(false);
    expect(
      (await FileSystem.getInfoAsync(localAudioPath("w1", url))).exists
    ).toBe(false);

    await downloadAudio("w2", url);
    await removeAudio("w2", url);
    expect(await audioExists("w2", url)).toBe(false);
  });

  it("un fallo de red en descarga propaga sin dejar parcial", async () => {
    __failNextDownloads("https://cdn.example.com/caido.mp3", 10);
    await expect(
      downloadAudio("w1", "https://cdn.example.com/caido.mp3")
    ).rejects.toThrow();
    expect(await audioExists("w1", "https://cdn.example.com/caido.mp3")).toBe(
      false
    );
  });
});

describe("adaptador de ilustraciones por contenido (B3-03)", () => {
  it("download/resolve/exists con fallback heredado", async () => {
    const url = "https://cdn.example.com/i.png";
    const dest = await downloadIllustration("w1", url);
    expect(dest.startsWith(`${FileSystem.documentDirectory}illustrations/url_`)).toBe(
      true
    );
    expect(await illustrationExists("w1", url)).toBe(true);
    expect(await resolveIllustrationUri({ id: "w1", illustrationUrl: url })).toBe(
      dest
    );

    const legacy = localIllustrationPath(
      "w2",
      "https://cdn.example.com/otro.png"
    );
    __seedFile(legacy, "legacy-img");
    expect(
      await resolveIllustrationUri({
        id: "w2",
        illustrationUrl: "https://cdn.example.com/otro.png",
      })
    ).toBe(legacy);

    await downloadWordIllustration({
      id: "w3",
      illustrationUrl: url,
      illustrationSha256: SHA_A,
    });
    expect(
      await resolveIllustrationUri({
        id: "w3",
        illustrationUrl: url,
        illustrationSha256: SHA_A,
      })
    ).toBe(`${FileSystem.documentDirectory}illustrations/${SHA_A}.png`);

    await removeIllustration("w1", url);
    expect(await illustrationExists("w1", url)).toBe(false);
  });
});
