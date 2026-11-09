/**
 * W3 — máquina de 6 estados de "Preparando contenido" (spec §4.2).
 * Lógica pura (testeable en Node); el render vive en
 * `src/components/seed-progress.tsx`. Copy neutral, sin hype.
 */

export type SeedStatus =
  | "checking"
  | "downloading"
  | "verifying"
  | "installing"
  | "ready"
  | "error";

export type SeedInstallPhase = "copiando datos" | "moviendo medios";

export interface SeedProgressValue {
  receivedBytes: number;
  totalBytes: number;
}

export type SeedState =
  | { status: "checking" }
  | { status: "downloading"; progress: SeedProgressValue }
  | { status: "verifying" }
  | { status: "installing"; phase: SeedInstallPhase }
  | { status: "ready" }
  | { status: "error"; message: string; canRetry: boolean; textOnly: boolean };

export type SeedEvent =
  | { type: "PROGRESS"; receivedBytes: number; totalBytes: number }
  | { type: "VERIFY" }
  | { type: "INSTALL"; phase: SeedInstallPhase }
  | { type: "DONE" }
  | { type: "FAIL"; message: string; canRetry: boolean }
  | { type: "RETRY" };

export const initialSeedState: SeedState = { status: "checking" };

/**
 * Transiciones: FAIL vale desde cualquier estado no terminal (nunca
 * bloqueo sin salida: el diccionario de texto queda utilizable);
 * el terminal `ready` ignora eventos tardíos de red.
 */
export function seedReducer(state: SeedState, event: SeedEvent): SeedState {
  if (state.status === "ready") return state;
  switch (event.type) {
    case "PROGRESS":
      return {
        status: "downloading",
        progress: { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes },
      };
    case "VERIFY":
      return { status: "verifying" };
    case "INSTALL":
      return { status: "installing", phase: event.phase };
    case "DONE":
      return { status: "ready" };
    case "FAIL":
      return { status: "error", message: event.message, canRetry: event.canRetry, textOnly: true };
    case "RETRY":
      return { status: "checking" };
  }
}

export interface SeedCopy {
  title: string;
  detail?: string;
}

/** Copy neutral exigido (spec §4.2); el error usa el mensaje específico. */
export function seedStatusCopy(state: SeedState): SeedCopy {
  switch (state.status) {
    case "checking":
      return { title: "Comprobando versión del contenido…" };
    case "downloading":
      return {
        title: "Descargando contenido…",
        detail: formatSeedProgress(state.progress.receivedBytes, state.progress.totalBytes),
      };
    case "verifying":
      return { title: "Verificando contenido…" };
    case "installing":
      return { title: "Instalando contenido…", detail: state.phase };
    case "ready":
      return { title: "Contenido listo" };
    case "error":
      return { title: state.message };
  }
}

const MB = 1_000_000;

/** "X de Y MB (N %)" con un decimal; total 0 → 0 % (sin NaN). */
export function formatSeedProgress(receivedBytes: number, totalBytes: number): string {
  const rx = (receivedBytes / MB).toFixed(1);
  const tx = (totalBytes / MB).toFixed(1);
  const pct = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
  return `${rx} de ${tx} MB (${pct} %)`;
}
