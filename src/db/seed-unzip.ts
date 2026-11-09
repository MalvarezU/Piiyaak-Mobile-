/**
 * W3 — envoltorio delgado sobre `react-native-zip-archive` v9 (spec §4.1).
 *
 * El módulo nativo solo existe en dev builds EAS (no en Expo Go ni en
 * Node): por eso la API se inyecta (`SeedUnzipApi`) y la resolución real
 * es perezosa (`loadUnzipApi`, import dinámico, nunca en tests).
 * La extracción real con progreso se verifica en dispositivo (§5.3);
 * acá se testea delegación, progreso y limpieza.
 */
import type { ZipProgressEvent } from "react-native-zip-archive";

export interface SeedUnzipApi {
  getUncompressedSize(zipPath: string): Promise<number>;
  unzip(source: string, target: string, charset?: string): Promise<string>;
  subscribe(listener: (event: ZipProgressEvent) => void): { remove(): void };
}

/** Resolución perezosa del módulo nativo (nunca llamar en Node/tests). */
export async function loadUnzipApi(): Promise<SeedUnzipApi> {
  return (await import("react-native-zip-archive")) as unknown as SeedUnzipApi;
}

/**
 * Descomprime el zip del seed en `targetDir` reenviando el progreso
 * nativo (0…1). Exige un destino no vacío dentro del temporal del
 * llamador; la protección ZipSlip real la aplica el módulo nativo
 * (`ERR_UNSAFE_PATH`), esto solo evita un destino degenerado.
 */
export async function unzipSeed(
  api: SeedUnzipApi,
  zipPath: string,
  targetDir: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!targetDir || !targetDir.startsWith("file://")) {
    throw new Error(`[seed-unzip] destino inválido: ${JSON.stringify(targetDir)}`);
  }
  const sub = api.subscribe((event) => onProgress?.(event.progress));
  try {
    return await api.unzip(zipPath, targetDir);
  } finally {
    sub.remove();
  }
}
