/**
 * Calidad de opciones para los juegos de opción múltiple.
 *
 * Resuelve tres defectos verificados del build anterior:
 * - Opciones duplicadas: los distractores se filtraban por id, no por la
 *   CADENA de la opción; con homónimos en el corpus un distractor podía
 *   igualar la respuesta (y `indexOf` marcaba la primera copia correcta).
 * - Fuga entre preguntas: preguntadas y distractores salían del mismo pool,
 *   así que la respuesta de la pregunta 5 aparecía como opción en la 1.
 * - Sesgo: nada garantizaba variedad; acá el orden de preferencia es
 *   explícito (no pedidas → ya pedidas → futuras como último recurso).
 */
import { shuffle } from "./game-random";

/**
 * Quita duplicados del pool por la clave `spanish + "||" + nasaYuwe`,
 * conservando la primera aparición.
 */
export function dedupePool<T extends { spanish: string; nasaYuwe: string }>(
  pool: readonly T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const w of pool) {
    const key = `${w.spanish}||${w.nasaYuwe}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

export interface BuildRoundOptions<T extends { spanish: string; nasaYuwe: string }> {
  /** Pool YA barajado por `pickGameWords`: el orden de entrada es aleatorio. */
  pool: readonly T[];
  askCount: number;
  /** Distractores por pregunta (3 en opción múltiple). */
  distractorCount: number;
  /** Cadena que se muestra como opción para una palabra. */
  answerOf: (w: T) => string;
  /** Opcional: con similaridad, los distractores salen más-parecidos-primero. */
  similarityOf?: (a: T, b: T) => number;
}

export interface BuiltQuestion<T> {
  word: T;
  options: string[];
  correctIndex: number;
}

/**
 * Arma las preguntas de una ronda con opciones únicas y sin fuga de
 * respuestas.
 *
 * Preferencia de distractores por pregunta `i`:
 * (a) palabras del pool que NO se preguntan en la ronda (fuga cero),
 * (b) ya preguntadas `asks[0..i-1]` (refuerzo, nunca engañoso),
 * (c) futuras `asks[i+1..]` como ÚLTIMO recurso (pool chico, p. ej. 4
 *     palabras): la excepción por construcción a la regla anti-fuga,
 *     alcanzada solo cuando (a)+(b) no alcanzan.
 *
 * En (a) y (b) están vetadas la respuesta actual y las de TODAS las
 * preguntas futuras. Nunca se emiten opciones repetidas dentro de una
 * pregunta; si el material único alcanza para menos de
 * `1 + distractorCount`, se devuelven las que haya (mínimo 2 cuando el
 * pool tiene palabras distintas; con datos degenerados de una sola cadena
 * única no hay material honesto para más).
 */
export function buildRound<T extends { spanish: string; nasaYuwe: string }>(opts: BuildRoundOptions<T>): BuiltQuestion<T>[] {
  const asks = dedupePool(opts.pool).slice(0, Math.max(0, opts.askCount));
  if (asks.length === 0) return [];
  const answers = asks.map(opts.answerOf);
  const askKeys = new Set(asks.map((w) => `${w.spanish}||${w.nasaYuwe}`));
  const questions: BuiltQuestion<T>[] = [];

  for (let i = 0; i < asks.length; i++) {
    const word = asks[i]!;
    const correct = answers[i]!;
    // Anti-fuga: respuestas de TODAS las preguntas futuras vetadas aquí.
    const banned = new Set<string>(answers.slice(i + 1));
    // Cadenas ya usadas en la pregunta (respuesta + distractores elegidos).
    const used = new Set<string>([correct]);
    const distractors: string[] = [];

    const take = (candidates: readonly T[], allowFutureAnswers: boolean): void => {
      for (const c of candidates) {
        if (distractors.length >= opts.distractorCount) return;
        const s = opts.answerOf(c);
        if (used.has(s)) continue;
        if (!allowFutureAnswers && banned.has(s)) continue;
        used.add(s);
        distractors.push(s);
      }
    };

    // Escalón (a): no pedidas. Con similaridad, más parecidas primero
    // (sort estable por índice original: los empates quedan aleatorios
    // porque el pool llega pre-barajado).
    const nonAsked = dedupePool(opts.pool.filter((w) => !askKeys.has(`${w.spanish}||${w.nasaYuwe}`)));
    if (opts.similarityOf) {
      const similarity = opts.similarityOf;
      const ranked = nonAsked
        .map((w, idx) => ({ w, s: similarity(word, w), idx }))
        .sort((a, b) => b.s - a.s || a.idx - b.idx)
        .map((r) => r.w);
      take(ranked, false);
    } else {
      take(nonAsked, false);
    }

    // Escalón (b): ya preguntadas (refuerzo).
    take(asks.slice(0, i), false);

    // Escalón (c): futuras, ÚLTIMO recurso; solo si (a)+(b) no llenaron.
    if (distractors.length < opts.distractorCount) {
      take(asks.slice(i + 1), true);
    }

    const options = shuffle([correct, ...distractors]);
    questions.push({ word, options, correctIndex: options.indexOf(correct) });
  }

  return questions;
}
