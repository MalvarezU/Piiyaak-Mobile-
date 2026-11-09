/**
 * W2 — máquina de 5 estados del aviso de contenido nuevo (spec §W2.3).
 * Lógica pura (testeable en Node, sin imports `expo-*`); el provider
 * (`db-context.tsx`) solo la conecta y el render vive en
 * `src/components/update-notice.tsx`.
 */
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
