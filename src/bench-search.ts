import { MemoryWordStore } from "./db/memory-store";
import type { WordRow } from "./db/types";
import { normalize } from "./normalize";

function makeWords(n: number): WordRow[] {
  const cats = ["sustantivo", "verbo", "adjetivo", "frase"];
  const out: WordRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `w${i}`,
      spanish: `palabra ${i} ${Math.random().toString(36).slice(2, 6)}`,
      nasaYuwe: `nw ${i}`,
      pronunciation: null,
      audioUrl: null,
      illustrationUrl: null,
      culturalContext: null,
      category: cats[i % cats.length]!,
      examples: null,
      status: "PUBLISHED",
      updatedAt: new Date().toISOString(),
    });
  }
  return out;
}

async function main() {
  const N = 10000;
  const store = new MemoryWordStore();
  const words = makeWords(N);
  await store.upsertWords(words);
  console.log(`Cargadas ${N} palabras`);

  const queries = ["pa", "palabra 5000", "zzzzz", "verbo", "nw 123"];
  const times: number[] = [];
  for (const q of queries) {
    const t0 = performance.now();
    const r = await store.search(q, 20);
    const dt = performance.now() - t0;
    times.push(dt);
    console.log(`  query "${q}" → ${r.length} resultados en ${dt.toFixed(2)} ms`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]!;
  const worst = Math.max(...times);
  console.log(`\np50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms worst=${worst.toFixed(2)}ms`);
  console.log(worst < 150 ? "✅ RNF-01 OK (<150ms)" : "❌ RNF-01 FAIL (>=150ms)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});