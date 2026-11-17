/**
 * Distancia y similaridad de cadenas para la calidad de opciones de los
 * juegos (puerto móvil).
 *
 * Puerto exacto de `Diccionario nasa /src/lib/game-utils.ts` (levenshtein y
 * stringSimilarity): misma firma, misma semántica, incluida la
 * normalización NFD que descarta diacríticos. Las dos plataformas deben
 * coincidir para que los distractores "parecidos" se comporten igual.
 */

/**
 * Distancia de Levenshtein entre dos cadenas (ignora mayúsculas y
 * diacríticos). Sirve para medir qué tan parecidas se escriben dos
 * palabras (o cómo suenan, si se le pasa la pronunciación).
 */
export function levenshtein(a: string, b: string): number {
  const s1 = a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const s2 = b.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  if (s1 === s2) return 0
  if (s1.length === 0) return s2.length
  if (s2.length === 0) return s1.length
  let prev = Array.from({ length: s2.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s1.length; i++) {
    let cur: number[] = [i]
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
  }
  return prev[s2.length]!
}

/**
 * Similaridad entre 0 y 1 (1 = idénticas). Útil para elegir distractores
 * parecidos y forzar discriminación fina (pares mínimos).
 */
export function stringSimilarity(a: string, b: string): number {
  const s1 = a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  const s2 = b.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
  if (s1 === s2) return 1
  const max = Math.max(s1.length, s2.length)
  if (max === 0) return 1
  return 1 - levenshtein(s1, s2) / max
}
