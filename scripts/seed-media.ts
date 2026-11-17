/**
 * Única fuente de verdad para el destino de los medios del seed en assets/.
 *
 * La carpeta destino se decide por el tipo MIME del archivo (no por el
 * prefijo del objectKey): `audio/*` va a `audios/`, `image/*` va a
 * `illustrations/`. El prefijo del objectKey varía según el productor del
 * seed (el script local emite `illustrations/<base>`, el generador web
 * emite `images/<uuid>.<ext>`), así que mapear por prefijo vuelve a fallar
 * cuando cambia el productor. El nombre del archivo destino es siempre el
 * basename del objectKey, válido para ambas convenciones.
 */
import { basename, join } from "node:path";

export type SeedMediaKind = "audios" | "illustrations";

/** Devuelve la carpeta destino según el tipo MIME del medio. */
export function seedMediaKind(mimeType: string): SeedMediaKind {
  if (mimeType.startsWith("audio/")) return "audios";
  if (mimeType.startsWith("image/")) return "illustrations";
  // El seed solo contiene audios e imágenes; otro tipo indica un manifiesto corrupto o un formato nuevo sin soporte.
  throw new Error(`tipo MIME no soportado para medios del seed: ${mimeType}`);
}

/** Ruta completa del medio embebido: <assetsDir>/<audios|illustrations>/<basename del objectKey>. */
export function seedMediaDest(
  assetsDir: string,
  mimeType: string,
  objectKey: string,
): string {
  return join(assetsDir, seedMediaKind(mimeType), basename(objectKey));
}
