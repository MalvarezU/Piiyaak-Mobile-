/**
 * W3 — descarga reanudable del seed (spec §4.3).
 *
 * Contrato (testeado): primero `manifest.json` liviano (decide SKIP
 * tardío); luego el zip vía `.part` + registro kv
 * `piiyaak:seedDownload:<N>` con `{ partName, totalBytes, updatedAt }`
 * (solo metadatos, nunca `resumeData` opaco). Reanudación entre
 * reinicios si hay `.part` + registro para el mismo `<N>` y el servidor
 * acepta rango; si no, descarga fresca con borrado del parcial.
 * El parcial queda aislado en `.part`; la db viva nunca se toca
 * (este módulo no recibe ningún handle de db).
 */
import { parseSeedManifest, type SeedManifest } from "./seed-manifest";

export type SeedManifestJson = unknown;

export type SeedDownloadReason = "red" | "espacio" | "manifiesto" | "stale";

export class SeedDownloadError extends Error {
  constructor(
    public readonly reason: SeedDownloadReason,
    message: string
  ) {
    super(`[seed-download] ${reason}: ${message}`);
    this.name = "SeedDownloadError";
  }
}

/** Registro kv `piiyaak:seedDownload:<N>` (spec §4.3 + W3.1). */
export interface SeedDownloadRecord {
  partName: string;
  totalBytes: number;
  updatedAt: string;
  /**
   * Opaco de `savable()` (spec §W3.1.1): se persiste tal cual y se
   * entrega tal cual a `createDownloadResumable`. Nunca se construye
   * a mano ni se interpreta. Ausente/`null` en registros anteriores
   * a W3 → se lee como `null` (re-descarga limpia).
   */
  resumeData?: string | null;
}

/**
 * Normaliza un registro leído del kv: compat con registros antiguos
 * (sin `resumeData` → `null`) y rechazo de formas rotas (`null`).
 * El opaco viaja intacto, byte a byte, sin parseo ni normalización.
 */
export function normalizeSeedRecord(raw: unknown): SeedDownloadRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.partName !== "string" || typeof r.totalBytes !== "number") {
    return null;
  }
  return {
    partName: r.partName,
    totalBytes: r.totalBytes,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    resumeData: typeof r.resumeData === "string" ? r.resumeData : null,
  };
}

export interface SeedDownloadDeps {
  tmpDir: string;
  fetchJson(url: string): Promise<unknown>;
  supportsResume(url: string): Promise<boolean>;
  partialSize(partUri: string): Promise<number | null>;
  removeFile(uri: string): Promise<void>;
  downloadFile(
    url: string,
    partUri: string,
    opts: { offset: number },
    onProgress: (receivedBytes: number, totalBytes: number) => void
  ): Promise<void>;
  readRecord(remote: string): Promise<SeedDownloadRecord | null>;
  writeRecord(remote: string, record: SeedDownloadRecord): Promise<void>;
  /**
   * W3 (opcionales; solo dispositivo/Nativo cuando existen):
   * - `sleep`: espera entre reintentos (inyectable para tests).
   * - `listPartUris`: `.part` visibles en `tmpDir` (sweep de ajenos).
   * - `pauseAndSavable`: `pauseAsync()` + `savable()` del task vivo.
   * - `resumeDownload`: `createDownloadResumable(..., resumeData)` +
   *   `resumeAsync()`; resuelve el status HTTP (guarda 206 en W3.3).
   */
  sleep?(ms: number): Promise<void>;
  listPartUris?(): Promise<string[]>;
  pauseAndSavable?(): Promise<string | null>;
  resumeDownload?(
    url: string,
    partUri: string,
    resumeData: string,
    onProgress: (receivedBytes: number, totalBytes: number) => void
  ): Promise<{ status: number }>;
}

export interface SeedDownloadResult {
  manifest: SeedManifest;
  zipUri: string;
  resumed: boolean;
}

/** URLs well-known (spec §4.1); la app NUNCA construye desde `latest.json`. */
export function seedFileUrls(
  baseUrl: string,
  remote: string
): { manifestUrl: string; zipUrl: string } {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    manifestUrl: `${base}/seed/${remote}/manifest.json`,
    zipUrl: `${base}/seed/${remote}/piiyaak-seed.zip`,
  };
}

/**
 * Base del seed (build-time `EXPO_PUBLIC_SEED_BASE_URL`, mismo valor que
 * `R2_PUBLIC_BASE_URL`). Vacía/ausente = seed deshabilitado (p. ej. hasta
 * que W2 publique el CDN real): el llamador sigue con texto.
 */
export function seedBaseUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const v = (env.EXPO_PUBLIC_SEED_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return v ? v : null;
}

function mapNetworkError(e: unknown): SeedDownloadError {
  const message = e instanceof Error ? e.message : String(e);
  if (/no space|enospc|insufficient|espacio/i.test(message)) {
    return new SeedDownloadError("espacio", message);
  }
  return new SeedDownloadError("red", message);
}

export async function downloadSeed(
  deps: SeedDownloadDeps,
  baseUrl: string,
  remote: string,
  onProgress: (receivedBytes: number, totalBytes: number) => void
): Promise<SeedDownloadResult> {
  const { manifestUrl, zipUrl } = seedFileUrls(baseUrl, remote);

  let raw: unknown;
  try {
    raw = await deps.fetchJson(manifestUrl);
  } catch (e) {
    throw mapNetworkError(e);
  }
  let manifest: SeedManifest;
  try {
    manifest = parseSeedManifest(raw);
  } catch (e) {
    throw new SeedDownloadError(
      "manifiesto",
      e instanceof Error ? e.message : "manifiesto inválido"
    );
  }
  // SKIP tardío: el manifiesto ya no corresponde al remoto del gate.
  if (manifest.contentVersion !== remote) {
    throw new SeedDownloadError(
      "stale",
      `manifiesto desactualizado: trae ${manifest.contentVersion}, se esperaba ${remote}`
    );
  }

  const partUri = `${deps.tmpDir}seed-${remote}.zip.part`;

  // W3.1.3: el `.part` de otra versión nunca se reanuda (la clave kv y el
  // nombre del archivo llevan la versión); se barre por higiene de disco.
  // Solo cuando el adaptador expone el listado (dispositivo y fakes nuevos).
  if (deps.listPartUris) {
    const visible = await deps.listPartUris();
    for (const uri of visible) {
      if (uri !== partUri && uri.endsWith(".zip.part")) {
        await deps.removeFile(uri);
      }
    }
  }

  const record = await deps.readRecord(remote);
  const consistent =
    record !== null &&
    record.partName === `seed-${remote}.zip.part` &&
    record.totalBytes === manifest.zipBytes;
  // Registro antiguo (sin `resumeData`) o inconsistente → `null`: la
  // decisión savable nace en `fresh`; el camino offset heredado sigue
  // vigente más abajo y preserva los tests existentes.
  const resumeData =
    record !== null && consistent && typeof record.resumeData === "string"
      ? record.resumeData
      : null;
  const existing = await deps.partialSize(partUri);
  const resumable =
    record !== null &&
    record.partName === `seed-${remote}.zip.part` &&
    record.totalBytes === manifest.zipBytes &&
    existing !== null &&
    existing > 0 &&
    existing < manifest.zipBytes &&
    (await deps.supportsResume(zipUrl));

  let resumed = false;
  if (resumable) {
    resumed = true;
  } else {
    if (existing !== null) await deps.removeFile(partUri);
  }
  const offset = resumed ? (existing ?? 0) : 0;
  await deps.writeRecord(remote, {
    partName: `seed-${remote}.zip.part`,
    totalBytes: manifest.zipBytes,
    updatedAt: new Date().toISOString(),
    // El opaco heredado se preserva para un futuro intento savable;
    // en descarga fresca nace `null`.
    resumeData,
  });

  try {
    // `downloadFile` reporta bytes absolutos del archivo final (incluye
    // el offset reanudado); se satura al total del manifiesto.
    await deps.downloadFile(zipUrl, partUri, { offset }, (received, total) =>
      onProgress(Math.min(received, total), total)
    );
  } catch (e) {
    throw mapNetworkError(e);
  }
  return { manifest, zipUri: partUri, resumed };
}
