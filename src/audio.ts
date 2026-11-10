import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { defaultMediaCache } from "./db/media-fs";
import type { MediaRef } from "./db/media-cache";

// Mapa estático de audios bundled (mismo patrón que ilustraciones):
// la DB almacena la ruta relativa ("audios/X.mp3") y aquí se resuelve
// a la URI local del asset embebido en el APK.
const BUNDLED_AUDIOS: Record<string, number> = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Buk.mp3"] = require("../assets/audios/Buk.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Kupe.mp3"] = require("../assets/audios/Kupe.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Les.mp3"] = require("../assets/audios/Les.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Nxusxa.mp3"] = require("../assets/audios/Nxusxa.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Peennxi.mp3"] = require("../assets/audios/Peennxi.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Pukat.mp3"] = require("../assets/audios/Pukat.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Taul.mp3"] = require("../assets/audios/Taul.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Tupa.mp3"] = require("../assets/audios/Tupa.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Uh.mp3"] = require("../assets/audios/Uh.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Vxlxilx.mp3"] = require("../assets/audios/Vxlxilx.mp3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_AUDIOS["audios/Zik.mp3"] = require("../assets/audios/Zik.mp3");
} catch {
  // Entorno de test (vitest/ESM): require() no disponible.
}

async function resolveBundledAudioUri(url: string): Promise<string | null> {
  const mod = BUNDLED_AUDIOS[url];
  if (mod === undefined) return null;
  try {
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    return asset.localUri ?? asset.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * Audios offline como adaptador delgado sobre `MediaCache` (B3-03).
 * Firmas públicas sin cambios; internamente resuelve por contenido
 * (`sha256`, F1-a) con fallback por URL normalizada (F1-b) y doble
 * lookup contra la ruta heredada por `wordId` (migración perezosa en
 * background, sin bloquear reproducción). Nunca escribe en la heredada.
 */
const AUDIO_DIR = `${FileSystem.documentDirectory}audios/`;

export interface WordAudio {
  id: string;
  audioUrl: string;
  audioSha256?: string | null;
}

function fallbackRef(wordId: string, audioUrl: string): MediaRef {
  return { wordId, kind: "audio", url: audioUrl, sha256: null };
}

function wordRef(word: WordAudio): MediaRef {
  return {
    wordId: word.id,
    kind: "audio",
    url: word.audioUrl,
    sha256: word.audioSha256 ?? null,
  };
}

export async function ensureAudioDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AUDIO_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  }
}

/** Ruta heredada por `wordId` (solo lectura/compatibilidad, B3-03). */
export function localAudioPath(wordId: string, audioUrl: string): string {
  const ext = audioUrl.split("?")[0]?.split(".").pop() ?? "mp3";
  return `${AUDIO_DIR}${wordId}.${ext}`;
}

export async function downloadAudio(
  wordId: string,
  audioUrl: string
): Promise<string> {
  return downloadWordAudio({ id: wordId, audioUrl });
}

export async function downloadWordAudio(word: WordAudio): Promise<string> {
  const cache = defaultMediaCache();
  const ref = wordRef(word);
  const dest = cache.localUriFor(ref);
  if ((await FileSystem.getInfoAsync(dest)).exists) return dest;
  // Migración desde el heredado antes de descargar (ahorra red).
  const legacy = localAudioPath(word.id, word.audioUrl);
  if ((await FileSystem.getInfoAsync(legacy)).exists) {
    try {
      await ensureAudioDir();
      await FileSystem.copyAsync({ from: legacy, to: dest });
      return dest;
    } catch {
      // Cae a descarga remota.
    }
  }
  await ensureAudioDir();
  return cache.ensureCached(ref);
}

export async function removeAudio(
  wordId: string,
  audioUrl: string
): Promise<void> {
  const cache = defaultMediaCache();
  for (const uri of [
    cache.localUriFor(fallbackRef(wordId, audioUrl)),
    localAudioPath(wordId, audioUrl),
  ]) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}

export async function removeWordAudio(word: WordAudio): Promise<void> {
  const cache = defaultMediaCache();
  try {
    await FileSystem.deleteAsync(cache.localUriFor(wordRef(word)), {
      idempotent: true,
    });
  } catch {
    // best-effort
  }
  await removeAudio(word.id, word.audioUrl);
}

export async function audioExists(
  wordId: string,
  audioUrl: string
): Promise<boolean> {
  const cache = defaultMediaCache();
  if (await cache.exists(fallbackRef(wordId, audioUrl))) return true;
  const info = await FileSystem.getInfoAsync(localAudioPath(wordId, audioUrl));
  return info.exists;
}

/**
 * Doble lookup (spec §1.3): contenido → heredado → remoto. Ante acierto
 * heredado programa la migración perezosa al nombre por contenido en
 * background, sin bloquear la reproducción.
 */
export async function resolveAudioUri(word: WordAudio): Promise<string> {
  const cache = defaultMediaCache();
  const ref = wordRef(word);
  if (await cache.exists(ref)) return cache.localUriFor(ref);
  if (ref.sha256) {
    // Transición F1-b → F1-a: el archivo puede vivir bajo la clave por URL.
    const fb = fallbackRef(word.id, word.audioUrl);
    if (await cache.exists(fb)) {
      migrateInBackground(cache.localUriFor(fb), cache.localUriFor(ref));
      return cache.localUriFor(fb);
    }
  }
  const legacy = localAudioPath(word.id, word.audioUrl);
  if ((await FileSystem.getInfoAsync(legacy)).exists) {
    migrateInBackground(legacy, cache.localUriFor(ref));
    return legacy;
  }
  // Audios bundled en el APK (assets/audios/): se resuelven a la URI
  // local del asset sin red.
  const bundled = await resolveBundledAudioUri(word.audioUrl);
  if (bundled) return bundled;
  return word.audioUrl;
}

function migrateInBackground(from: string, to: string): void {
  (async () => {
    try {
      await FileSystem.makeDirectoryAsync(to.slice(0, to.lastIndexOf("/") + 1), {
        intermediates: true,
      });
      await FileSystem.copyAsync({ from, to });
    } catch {
      // best-effort: el próximo lookup lo reintenta.
    }
  })();
}
