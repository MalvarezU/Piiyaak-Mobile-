/**
 * W2 — máquina de 5 estados del aviso de contenido nuevo (spec §W2.3).
 * Lógica pura (testeable en Node, sin imports `expo-*`); el provider
 * (`db-context.tsx`) solo la conecta y el render vive en
 * `src/components/update-notice.tsx`.
 */
import { z } from "zod";
import { compareVersions } from "./version-gate";

export interface UpdateAvailable {
  remote: string;
  serverTime: string;
  bytesTotal: number | null;
  files: number | null;
}

export type UpdateNoticeState =
  | { status: "checking" }
  | { status: "none" }
  | { status: "available"; update: UpdateAvailable }
  | { status: "dismissed"; remote: string }
  | { status: "downloading" };

export const initialUpdateNoticeState: UpdateNoticeState = { status: "checking" };

export interface NoticeMetadata {
  bytesTotal: number | null;
  files: number | null;
}

export interface DecideNoticeInput {
  local: string | null;
  remote: string;
  serverTime: string;
  dismissed: string | null;
  metadata: NoticeMetadata;
}

/**
 * `checking → none | available | dismissed`.
 * `skip`/`noop` del gate → `none`; `seed` + `dismissed === remote` →
 * `dismissed`; si no → `available` con los metadatos recibidos.
 * `dismissed → available` ocurre solo si `remote` cambia (el descarte
 * viejo deja de coincidir). La comparación la decide `compareVersions`
 * (spec §W2.2); este módulo solo ramifica el aviso.
 */
export function decideNotice(input: DecideNoticeInput): UpdateNoticeState {
  const move = compareVersions(input.local, input.remote);
  if (move.action !== "seed") return { status: "none" };
  if (input.dismissed === move.remote) {
    return { status: "dismissed", remote: move.remote };
  }
  return {
    status: "available",
    update: {
      remote: move.remote,
      serverTime: input.serverTime,
      bytesTotal: input.metadata.bytesTotal,
      files: input.metadata.files,
    },
  };
}

/** `available → dismissed` (el llamador persiste `remote`, spec §W2.4). */
export function dismissNotice(state: UpdateNoticeState): UpdateNoticeState {
  if (state.status !== "available") return state;
  return { status: "dismissed", remote: state.update.remote };
}

/** `available → downloading` (delega a `runSeedInternal` vigente). */
export function acceptNotice(state: UpdateNoticeState): UpdateNoticeState {
  if (state.status !== "available") return state;
  return { status: "downloading" };
}

/** `downloading → none` (al llegar `SeedState` ready o `continueTextOnly`). */
export function settleNotice(state: UpdateNoticeState): UpdateNoticeState {
  if (state.status !== "downloading") return state;
  return { status: "none" };
}

/** Clave kv del descarte (spec §W2.4; mismo prefijo `piiyaak:` de `version-gate`). */
export const DISMISSED_UPDATE_KEY = "piiyaak:dismissedUpdate";

/**
 * Metadatos de display (spec §W2.1): `latest.json` solo adorna el aviso,
 * nunca decide SKIP ni versiones ni URLs de descarga.
 */
export const LatestJsonSchema = z.object({
  contentVersion: z.string().regex(/^\d+$/),
  manifestUrl: z.string().url(),
  zipUrl: z.string().url(),
  bytesTotal: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type LatestJson = z.infer<typeof LatestJsonSchema>;

/**
 * Reglas §W2.1.1–2: `latest.json` ilegible/inválido o divergente
 * (`contentVersion !== remote` del gate) → nulls; el gate manda.
 */
export function metadataOrNull(raw: unknown, remote: string): NoticeMetadata {
  const parsed = LatestJsonSchema.safeParse(raw);
  if (!parsed.success) return { bytesTotal: null, files: null };
  if (parsed.data.contentVersion !== remote) return { bytesTotal: null, files: null };
  return { bytesTotal: parsed.data.bytesTotal, files: parsed.data.files };
}

/**
 * Lee `latest.json` (`GET <base>/seed/latest.json`).
 * `!ok` (404: aún no publicado) → `null` (aviso con nulls, regla 1);
 * fallo de red → lanza (el `catch` vigente del provider lo cubre:
 * sin aviso, regla 3). Nunca usa las URLs del cuerpo: la descarga
 * sigue las well-known de `seedFileUrls`.
 */
export async function fetchLatestJson(baseUrl: string): Promise<unknown> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/seed/latest.json`);
  if (!res.ok) return null;
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Store mínimo para el descarte (el `WordStore` real lo satisface). */
export interface DismissedStore {
  getKV(key: string): Promise<string | null>;
  setKV(key: string, value: string): Promise<void>;
}

export async function readDismissedVersion(store: DismissedStore): Promise<string | null> {
  const raw = await store.getKV(DISMISSED_UPDATE_KEY);
  if (!raw || !/^\d+$/.test(raw)) return null;
  return raw;
}

export async function writeDismissedVersion(store: DismissedStore, remote: string): Promise<void> {
  await store.setKV(DISMISSED_UPDATE_KEY, remote);
}

export async function clearDismissedVersion(store: DismissedStore): Promise<void> {
  // `WordStore` no expone borrado: lápida vacía que `readDismissedVersion`
  // trata como ausente (mismo patrón que `clearDownloadRecord` en seed-expo).
  await store.setKV(DISMISSED_UPDATE_KEY, "");
}
