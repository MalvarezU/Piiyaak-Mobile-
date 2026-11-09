/**
 * Mock en memoria de `expo-file-system` (B3-01, R6/CA8).
 *
 * Ubicación normativa: junto a los tests que lo consumen
 * (`src/db/__mocks__/`). Superficie cubierta, sin disco real:
 * `documentDirectory`, `getInfoAsync`, `makeDirectoryAsync`,
 * `downloadAsync`, `deleteAsync`, `readDirectoryAsync` (+ `copyAsync`,
 * necesario para la migración perezosa del doble lookup de B3-03;
 * `expo-file-system` lo provee y el mock lo replica en memoria).
 *
 * Uso: `vi.mock("expo-file-system", () => import("./__mocks__/expo-file-system"))`.
 * Ningún test de medios toca disco real.
 */

export const documentDirectory: string | null = "file:///mock-doc/";

interface Entry {
  bytes: string;
  isDirectory: boolean;
}

const files = new Map<string, Entry>();
const failPlan = new Map<string, number>();

const normDir = (uri: string): string =>
  uri.endsWith("/") ? uri : `${uri}/`;

export function __reset(): void {
  files.clear();
  failPlan.clear();
}

export function __listAll(): string[] {
  return [...files.keys()];
}

export function __seedFile(uri: string, bytes = "bytes"): void {
  files.set(uri, { bytes, isDirectory: false });
}

/** Hace que las próximas `times` descargas de `url` lancen error de red. */
export function __failNextDownloads(url: string, times: number): void {
  failPlan.set(url, times);
}

export async function getInfoAsync(
  uri: string
): Promise<{ exists: boolean; uri: string; size?: number; isDirectory?: boolean }> {
  const hit = files.get(uri);
  if (!hit) {
    // Un directorio creado cuenta como existente aunque no tenga marcador.
    for (const key of files.keys()) {
      if (key.startsWith(normDir(uri))) {
        return { exists: true, uri, isDirectory: true };
      }
    }
    return { exists: false, uri };
  }
  return {
    exists: true,
    uri,
    size: hit.bytes.length,
    isDirectory: hit.isDirectory,
  };
}

export async function makeDirectoryAsync(
  uri: string,
  _options?: { intermediates?: boolean }
): Promise<void> {
  files.set(normDir(uri), { bytes: "", isDirectory: true });
}

export async function downloadAsync(
  url: string,
  fileUri: string,
  _options?: unknown
): Promise<{ uri: string; status: number; headers: Record<string, string> }> {
  const remaining = failPlan.get(url) ?? 0;
  if (remaining > 0) {
    failPlan.set(url, remaining - 1);
    throw new Error(`mock network failure: ${url}`);
  }
  files.set(fileUri, { bytes: `bytes-of:${url}`, isDirectory: false });
  return { uri: fileUri, status: 200, headers: {} };
}

export async function deleteAsync(
  uri: string,
  options?: { idempotent?: boolean }
): Promise<void> {
  if (files.delete(uri)) return;
  // Borrado de prefijo (directorio): elimina todo lo que cuelga de él.
  const prefix = normDir(uri);
  let removed = false;
  for (const key of [...files.keys()]) {
    if (key.startsWith(prefix)) {
      files.delete(key);
      removed = true;
    }
  }
  if (!removed && !options?.idempotent) {
    throw new Error(`mock file not found: ${uri}`);
  }
}

export async function readDirectoryAsync(fileUri: string): Promise<string[]> {
  const prefix = normDir(fileUri);
  const names: string[] = [];
  for (const key of files.keys()) {
    if (!key.startsWith(prefix) || key === prefix) continue;
    const rest = key.slice(prefix.length);
    if (!rest.includes("/")) names.push(rest);
  }
  return names;
}

export async function copyAsync(options: {
  from: string;
  to: string;
}): Promise<void> {
  const src = files.get(options.from);
  if (!src || src.isDirectory) {
    throw new Error(`mock copy source not found: ${options.from}`);
  }
  files.set(options.to, { bytes: src.bytes, isDirectory: false });
}
