/**
 * Frontera nativa del media-cache (B3-03): `MediaStore` sobre el
 * `expo-file-system` real + singleton `defaultMediaCache` para la app.
 *
 * Este módulo importa `expo-file-system`, por lo que NO se carga en tests
 * Node: los tests usan `createMemoryMediaStore` o el mock
 * `src/db/__mocks__/expo-file-system` (vía `vi.mock`).
 */
import * as FileSystem from "expo-file-system/legacy";
import {
  createMediaCache,
  type MediaCache,
  type MediaRef,
  type MediaStore,
} from "./media-cache";

export function expoMediaStore(): MediaStore {
  return {
    async getInfo(uri: string) {
      return { exists: (await FileSystem.getInfoAsync(uri)).exists };
    },
    async makeDir(uri: string) {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
      }
    },
    async download(url: string, destUri: string) {
      const result = await FileSystem.downloadAsync(url, destUri);
      return { uri: result.uri };
    },
    async remove(uri: string) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },
    async listDir(dirUri: string) {
      const prefix = dirUri.endsWith("/") ? dirUri : `${dirUri}/`;
      const entries = await FileSystem.readDirectoryAsync(dirUri);
      // Normaliza a URIs completas: el mock devuelve nombres y la API
      // real puede devolver nombres o rutas según plataforma.
      return entries.map((e) =>
        e.startsWith(prefix) || e.includes("://") ? e : `${prefix}${e}`
      );
    },
    async copy(fromUri: string, toUri: string) {
      await FileSystem.copyAsync({ from: fromUri, to: toUri });
    },
  };
}

let singleton: MediaCache | null = null;

/** Cache compartido de la app (documentDirectory real). */
export function defaultMediaCache(): MediaCache {
  if (!singleton) {
    const base = FileSystem.documentDirectory ?? "file:///piiyaak-media/";
    singleton = createMediaCache(expoMediaStore(), { baseDir: base });
  }
  return singleton;
}

/**
 * Resolución para medios sin pasado heredado (bloques de lección,
 * portadas de curso): contenido si existe, remoto si no.
 */
export async function resolveCachedUri(ref: MediaRef): Promise<string> {
  const cache = defaultMediaCache();
  return (await cache.exists(ref)) ? cache.localUriFor(ref) : ref.url;
}
