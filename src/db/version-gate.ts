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
  contentVersion: z.string().min(1),
  serverTime: z.string().datetime(),
});
export type VersionResponse = z.infer<typeof VersionResponseSchema>;

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
