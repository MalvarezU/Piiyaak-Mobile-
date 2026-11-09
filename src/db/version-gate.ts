import { z } from "zod";
import { apiFetch, type SessionState } from "../api";
import type { WordStore } from "./sqlite-store";

/** Claves kv unificadas (spec §2.1): siempre con prefijo `piiyaak:`. */
export const CONTENT_VERSION_KEY = "piiyaak:contentVersion";
export const LAST_SYNC_KEY = "piiyaak:lastSync";

export interface VersionInfo {
  contentVersion: string;
  serverTime: string;
}

export const VersionResponseSchema = z.object({
  // F0 — borde tolerante, escritura canónica: acepta el string canónico
  // (`/^\d+$/`) o el number legacy y normaliza siempre a string. Lo que se
  // persiste en kv es el resultado de este transform, nunca el raw.
  contentVersion: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .transform((v) => String(v)),
  serverTime: z.string().datetime(),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;

/**
 * F0 — comparador solo-adelante (spec §1.3, implementado en W3 §4.6).
 * Igualdad sobre el string canónico; orden sobre parseInt validado.
 * `remote < local` es no-op (D3): el llamador mantiene local y emite el
 * warn estructurado; esta función solo clasifica, nunca escribe.
 */
export type VersionMove =
  | { action: "skip" } // remote == local
  | { action: "seed"; remote: string } // remote > local, o local ausente/inválido
  | { action: "noop"; reason: string }; // remote < local

const CANONICAL_VERSION = /^\d+$/;

export function compareVersions(local: string | null, remote: string): VersionMove {
  if (!CANONICAL_VERSION.test(remote)) {
    throw new Error(`[version-gate] remote ilegible: ${JSON.stringify(remote)}`);
  }
  if (local === null || !CANONICAL_VERSION.test(local)) {
    return { action: "seed", remote };
  }
  if (local === remote) return { action: "skip" };
  if (parseInt(remote, 10) < parseInt(local, 10)) {
    return {
      action: "noop",
      reason: `remote ${remote} < local ${local}: sin downgrade (D3), se mantiene local`,
    };
  }
  return { action: "seed", remote };
}

/**
 * Lee la versión remota sin exigir sesión: con `null` se omite el
 * encabezado de autenticación y la respuesta se valida con Zod en el borde.
 */
export async function getRemoteVersion(
  authToken: SessionState | null
): Promise<VersionInfo> {
  const res = await apiFetch("/api/sync/version", {}, authToken);
  if (!res.ok) throw new Error(`version ${res.status}`);
  const body = VersionResponseSchema.parse(await res.json());
  return { contentVersion: body.contentVersion, serverTime: body.serverTime };
}

export async function getLocalVersion(
  store: WordStore
): Promise<{ contentVersion: string | null; lastSync: string | null }> {
  const [contentVersion, lastSync] = await Promise.all([
    store.getKV(CONTENT_VERSION_KEY),
    store.getLastSync(),
  ]);
  return { contentVersion, lastSync };
}

/**
 * Escritura conjunta: si cualquiera de las dos claves falla, la promesa
 * rechaza y la sincronización se considera no confirmada (el próximo
 * arranque repite el gate en lugar de operar con versión huérfana).
 */
export async function setLocalVersion(
  store: WordStore,
  version: VersionInfo
): Promise<void> {
  await store.setKV(CONTENT_VERSION_KEY, version.contentVersion);
  await store.setLastSync(version.serverTime);
}
