/** Tokenizador de Nasa Yuwe para el juego "Ordena la palabra" (port móvil). */

const GLOTTAL_VOWELS = new Set(["a", "e", "i", "u", "ã", "ũ"]);

const CLUSTERS: readonly string[] = [
  "txh", "th", "ph", "kh", "sx", "nx", "lx", "px", "çx", "fx", "jx", "vx", "tx", "çh",
];

const CLUSTER_SET = new Set(CLUSTERS);
const CLUSTER_3 = new Set(CLUSTERS.filter((c) => c.length === 3));

export function normalizeOrdenaApos(word: string): string {
  return word.replace(/[\u2019\u00B4]/g, "'");
}

export function tokenizeOrdena(word: string): string[] {
  const src = normalizeOrdenaApos(word);
  const lower = src.toLowerCase();
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = lower[i]!;
    if (GLOTTAL_VOWELS.has(ch) && lower[i + 1] === "'") {
      tokens.push(src.slice(i, i + 2));
      i += 2;
      continue;
    }
    const tri = lower.slice(i, i + 3);
    if (tri.length === 3 && CLUSTER_3.has(tri)) {
      tokens.push(src.slice(i, i + 3));
      i += 3;
      continue;
    }
    const duo = lower.slice(i, i + 2);
    if (duo.length === 2 && CLUSTER_SET.has(duo)) {
      tokens.push(src.slice(i, i + 2));
      i += 2;
      continue;
    }
    tokens.push(src[i]!);
    i += 1;
  }
  return tokens;
}

export interface OrdenaCandidate {
  spanish: string;
  nasaYuwe: string;
}

export function isOrdenaEligible(word: OrdenaCandidate): boolean {
  const ny = word.nasaYuwe ?? "";
  const es = (word.spanish ?? "").trim();
  if (!es) return false;
  if (/\s/.test(ny)) return false;
  if (ny.includes("(Esp")) return false;
  if (es.toLowerCase() === ny.toLowerCase()) return false;
  return tokenizeOrdena(ny).length > 2;
}