/**
 * W3.2 — decisión pura resume-vs-fresco (spec §W3.2, matriz normativa).
 *
 * Sin imports `expo-*`: testeable en Node. El `resumeData` es opaco
 * (nunca se interpreta; solo se verifica presencia/ausencia).
 */
export interface ResumeRecord {
  resumeData: string | null;
  totalBytes: number;
}

export interface ResumeInput {
  record: ResumeRecord | null;
  /** Tamaño actual del `.part` (`partialSize`); `null` = no existe. */
  existingBytes: number | null;
  /** HEAD `accept-ranges: bytes` (vigente). */
  supportsResume: boolean;
  /** Status HTTP del resume; `null` = aún no intentado. */
  resumedStatus: number | null;
}

export type ResumeDecision =
  | { action: "resume" }
  | { action: "fresh" }
  | { action: "truncate-and-fresh" };

/**
 * Matriz §W3.2. La guarda `status === 206` es obligatoria tras cada
 * `resumeAsync()`: cualquier otro status → `truncate-and-fresh`
 * (el servidor ignoró el rango; append ciego corrompe).
 */
export function decideResume(input: ResumeInput): ResumeDecision {
  const { record, existingBytes, supportsResume, resumedStatus } = input;
  if (record === null || !record.resumeData) return { action: "fresh" };
  const partial =
    existingBytes !== null && existingBytes > 0 && existingBytes < record.totalBytes;
  if (!partial) return { action: "fresh" };
  if (!supportsResume) return { action: "fresh" };
  if (resumedStatus === null || resumedStatus === 206) return { action: "resume" };
  return { action: "truncate-and-fresh" };
}
