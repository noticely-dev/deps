// Dogfooding: run the analysis on this repository's own package.json + lockfile (live upstream data).
import { readFileSync } from 'node:fs';
import { parseInput } from '../src/analyze/parse.js';
import { loadReplacements } from '../src/analyze/replacements.js';
import { analyzeDeps } from '../src/check/analyze-deps.js';
import { createSources } from '../src/sources/index.js';
import { memoryCache } from '../src/store/cache.js';

const input = parseInput(readFileSync('package.json', 'utf8'), readFileSync('package-lock.json', 'utf8'));
const sources = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache() });
const result = await analyzeDeps(input, sources, loadReplacements('data/replacements.json'), new Date(), AbortSignal.timeout(60_000));

console.log(`Self-check: score ${result.score}/100 (${result.label}) — ${result.summary}`);
for (const p of result.packages.filter((x) => x.risk !== 'healthy')) {
  console.log(`  ${p.risk.padEnd(8)} ${p.scope.padEnd(4)} ${p.name}@${p.resolved}: ${p.findings.map((f) => f.text).join('; ')}`);
}
if (result.partial.length) console.log(`  (partial data: ${result.partial.join(', ')})`);
const blocking = result.packages.filter((p) => p.risk === 'critical' || p.risk === 'high');
if (blocking.length) {
  console.error(`Self-check failed: ${blocking.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
