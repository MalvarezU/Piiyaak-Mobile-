import * as FileSystem from "expo-file-system/legacy";
import { Asset } from "expo-asset";
import { defaultMediaCache } from "./db/media-fs";
import type { MediaRef } from "./db/media-cache";

// Mapa estático de ilustraciones bundled (mismo patrón que el audio en
// juegos/escucha): la DB almacena la ruta relativa ("illustrations/X.png")
// y aquí se resuelve a la URI local del asset embebido en el APK.
// Se popula de forma lazy para no romper vitest (ESM no soporta require()).
const BUNDLED_ILLUSTRATIONS: Record<string, number> = {};
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_ILLUSTRATIONS["illustrations/TUPA.png"] = require("../assets/illustrations/TUPA.png");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_ILLUSTRATIONS["illustrations/TXITE.png"] = require("../assets/illustrations/TXITE.png");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_ILLUSTRATIONS["illustrations/YAT.png"] = require("../assets/illustrations/YAT.png");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BUNDLED_ILLUSTRATIONS["illustrations/A_TE.png"] = require("../assets/illustrations/A_TE.png");
} catch {
  // Entorno de test (vitest/ESM): require() no disponible; el mapa queda vacío
  // y resolveIllustrationUri cae al flujo normal (cache/legacy/remoto).
}

async function resolveBundledIllustrationUri(url: string): Promise<string | null> {
  const mod = BUNDLED_ILLUSTRATIONS[url];
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
 * Ilustraciones offline como adaptador delgado sobre `MediaCache` (B3-03).
 * Firmas públicas sin cambios; internamente resuelve por contenido
 * (`sha256`, F1-a) con fallback por URL normalizada (F1-b) y doble
 * lookup contra la ruta heredada por `wordId` (migración perezosa en
 * background). Nunca escribe en la heredada.
 */
const ILL_DIR = `${FileSystem.documentDirectory}illustrations/`;

export interface WordIllustrationRef {
  id: string;
  illustrationUrl: string;
  illustrationSha256?: string | null;
}

function fallbackRef(wordId: string, url: string): MediaRef {
  return { wordId, kind: "illustration", url, sha256: null };
}

function wordRef(word: WordIllustrationRef): MediaRef {
  return {
    wordId: word.id,
    kind: "illustration",
    url: word.illustrationUrl,
    sha256: word.illustrationSha256 ?? null,
  };
}

export async function ensureIllustrationDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(ILL_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(ILL_DIR, { intermediates: true });
  }
}

/** Ruta heredada por `wordId` (solo lectura/compatibilidad, B3-03). */
export function localIllustrationPath(wordId: string, url: string): string {
  const ext = url.split("?")[0]?.split(".").pop() ?? "png";
  return `${ILL_DIR}${wordId}.${ext}`;
}

export async function downloadIllustration(
  wordId: string,
  url: string
): Promise<string> {
  return downloadWordIllustration({ id: wordId, illustrationUrl: url });
}

export async function downloadWordIllustration(
  word: WordIllustrationRef
): Promise<string> {
  const cache = defaultMediaCache();
  const ref = wordRef(word);
  const dest = cache.localUriFor(ref);
  if ((await FileSystem.getInfoAsync(dest)).exists) return dest;
  const legacy = localIllustrationPath(word.id, word.illustrationUrl);
  if ((await FileSystem.getInfoAsync(legacy)).exists) {
    try {
      await ensureIllustrationDir();
      await FileSystem.copyAsync({ from: legacy, to: dest });
      return dest;
    } catch {
      // Cae a descarga remota.
    }
  }
  await ensureIllustrationDir();
  return cache.ensureCached(ref);
}

export async function removeIllustration(
  wordId: string,
  url: string
): Promise<void> {
  const cache = defaultMediaCache();
  for (const uri of [
    cache.localUriFor(fallbackRef(wordId, url)),
    localIllustrationPath(wordId, url),
  ]) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // best-effort
    }
  }
}

export async function removeWordIllustration(
  word: WordIllustrationRef
): Promise<void> {
  const cache = defaultMediaCache();
  try {
    await FileSystem.deleteAsync(cache.localUriFor(wordRef(word)), {
      idempotent: true,
    });
  } catch {
    // best-effort
  }
  await removeIllustration(word.id, word.illustrationUrl);
}

export async function illustrationExists(
  wordId: string,
  url: string
): Promise<boolean> {
  const cache = defaultMediaCache();
  if (await cache.exists(fallbackRef(wordId, url))) return true;
  const info = await FileSystem.getInfoAsync(localIllustrationPath(wordId, url));
  return info.exists;
}

/**
 * Doble lookup (spec §1.3): contenido → heredado → remoto, con migración
 * perezosa en background ante acierto heredado.
 */
export async function resolveIllustrationUri(
  word: WordIllustrationRef
): Promise<string> {
  const cache = defaultMediaCache();
  const ref = wordRef(word);
  if (await cache.exists(ref)) return cache.localUriFor(ref);
  if (ref.sha256) {
    const fb = fallbackRef(word.id, word.illustrationUrl);
    if (await cache.exists(fb)) {
      migrateInBackground(cache.localUriFor(fb), cache.localUriFor(ref));
      return cache.localUriFor(fb);
    }
  }
  const legacy = localIllustrationPath(word.id, word.illustrationUrl);
  if ((await FileSystem.getInfoAsync(legacy)).exists) {
    migrateInBackground(legacy, cache.localUriFor(ref));
    return legacy;
  }
  // Ilustraciones bundled en el APK (assets/illustrations/): se resuelven
  // a la URI local del asset sin red.
  const bundled = await resolveBundledIllustrationUri(word.illustrationUrl);
  if (bundled) return bundled;
  return word.illustrationUrl;
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
