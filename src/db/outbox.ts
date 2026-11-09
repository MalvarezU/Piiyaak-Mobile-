import type { OutboxRow } from "./sqlite-store";

/**
 * Política de `outbox` sin sesión (spec §4, B4-01). No rediseña el
 * mecanismo, lo documenta y le pone límites:
 *
 * 1. **Acumular sin sesión, sin pérdida:** toda escritura sin sesión
 *    (favorita, historial local, `course_progress`) se registra en `outbox`
 *    con su payload íntegro. Ninguna ruta descarta entradas por falta de
 *    sesión. `flushOutbox(store, null)` y `flushCourseProgress(…, null)`
 *    conservan su no-operación: es comportamiento especificado, no omisión.
 * 2. **Drenar al iniciar sesión, en FIFO:** `pendingOutbox()` retorna en
 *    orden ascendente de `id`; cada entrada se marca sincronizada **solo**
 *    ante respuesta `ok` del servidor. Fallo de red o respuesta no-ok deja
 *    la entrada pendiente para el próximo intento. Nunca se marca en lote.
 * 3. **Idempotencia por clave:** las favoritas se drenan como estado
 *    convergente (`collapseOutboxForDrain`: la última operación por
 *    `wordId` prevalece; las intermedias se subsumen y se marcan junto con
 *    el `ok` de la superviviente, ya que su efecto quedó incluido).
 *    Historial y progreso se drenan íntegros (cada vista/completitud
 *    cuenta; no se colapsan).
 * 4. **Límites:** más de `OUTBOX_MAX_PENDING` pendientes rechaza escrituras
 *    nuevas con error visible ("inicie sesión"); payloads de más de
 *    `OUTBOX_PAYLOAD_MAX_BYTES` se rechazan en `addOutbox`. Ambos lanzan
 *    `OutboxLimitError` con mensaje en el idioma de la UI.
 * 5. **Doble drenaje:** `flushOutbox` es idempotente por entrada, así que
 *    las invocaciones concurrentes (login, foreground, `syncData`) no
 *    duplican efectos observables para favoritas (colapso por clave).
 * 6. **Sin sesión prolongada:** el contador `pendingOutboxCount` del
 *    contexto ya se muestra en ajustes; el usuario acumula hasta el límite
 *    y el login drena.
 */

/** Máximo de entradas pendientes antes de rechazar escrituras (spec §1.4). */
export const OUTBOX_MAX_PENDING = 500;

/** Máximo de bytes UTF-8 por payload de entrada (spec §1.4). */
export const OUTBOX_PAYLOAD_MAX_BYTES = 4096;

/**
 * Rechazo de escritura al outbox por límite. El mensaje es visible al
 * usuario (idioma de la UI) e indica qué hacer.
 */
export class OutboxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxLimitError";
  }
}

/** Rechaza payloads que superen `OUTBOX_PAYLOAD_MAX_BYTES`. */
export function checkOutboxPayloadSize(payload: string): void {
  if (new TextEncoder().encode(payload).length > OUTBOX_PAYLOAD_MAX_BYTES) {
    throw new OutboxLimitError(
      `Cambio demasiado grande para sincronizar (${OUTBOX_PAYLOAD_MAX_BYTES} bytes máximos).`
    );
  }
}

/** Rechaza escrituras nuevas cuando el pendiente alcanza el máximo. */
export function checkOutboxCapacity(pendingCount: number): void {
  if (pendingCount >= OUTBOX_MAX_PENDING) {
    throw new OutboxLimitError(
      "Hay demasiados cambios pendientes de sincronizar; inicie sesión para enviarlos."
    );
  }
}

/** `wordId` de una entrada de favorita; `null` si el payload no lo trae. */
export function favoriteWordId(row: Pick<OutboxRow, "payload">): string | null {
  try {
    const parsed = JSON.parse(row.payload) as { wordId?: unknown };
    return typeof parsed.wordId === "string" && parsed.wordId.length > 0
      ? parsed.wordId
      : null;
  } catch {
    return null;
  }
}

export interface CollapsedOutbox {
  /** Entradas a enviar, en FIFO original. */
  toSend: OutboxRow[];
  /** Ids subsumidos por el colapso (favoritas intermedias del mismo `wordId`). */
  subsumedIds: number[];
}

/**
 * Colapso por clave antes del envío (spec §4.3): de las favoritas con el
 * mismo `wordId` solo sobrevive la última (orden de `id`); historial,
 * progreso y favoritas sin `wordId` parseable van íntegras y en orden.
 * Función pura sobre el pendiente ya ordenado (FIFO).
 */
export function collapseOutboxForDrain(
  pending: readonly OutboxRow[]
): CollapsedOutbox {
  const lastByWord = new Map<string, number>();
  for (const row of pending) {
    if (row.entity !== "favorite") continue;
    const wordId = favoriteWordId(row);
    if (wordId !== null) lastByWord.set(wordId, row.id);
  }
  const survivors = new Set(lastByWord.values());
  const toSend: OutboxRow[] = [];
  const subsumedIds: number[] = [];
  for (const row of pending) {
    if (
      row.entity === "favorite" &&
      favoriteWordId(row) !== null &&
      !survivors.has(row.id)
    ) {
      subsumedIds.push(row.id);
      continue;
    }
    toSend.push(row);
  }
  return { toSend, subsumedIds };
}
