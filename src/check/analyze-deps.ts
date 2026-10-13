import { buildPlan } from '../analyze/plan.js';
import { resolveDep } from '../analyze/resolve.js';
import { evaluatePackage } from '../analyze/rules.js';
import { computeCounts, computeScore } from '../analyze/score.js';
import { buildSummary } from '../analyze/summary.js';
import type { PackageData, Replacement, ReportResult, SourceName, StoredDep } from '../analyze/types.js';
import type { Sources } from '../sources/index.js';

export async function analyzeDeps(
  input: { deps: StoredDep[] }, sources: Sources, replacements: Record<string, Replacement>, now: Date, signal?: AbortSignal,
): Promise<ReportResult> {
  const names = [...new Set(input.deps.map((d) => d.name))];
  const { infos, unavailable: npmDown } = await sources.npmInfos(names, signal);
  const resolved = input.deps.map((d) => resolveDep(d, infos.get(d.name), npmDown));

  const items = resolved.filter((r) => r.resolved !== null).map((r) => ({ name: r.name, version: r.resolved as string }));
  const details = await sources.details(items, signal);

  const packages = resolved.map((r) => {
    const key = `${r.name}@${r.resolved}`;
    const data: PackageData = {
      npm: infos.get(r.name),
      downloads: details.downloads.get(r.name) ?? null,
      depsdev: details.depsdev.get(key) ?? null,
      vulnIds: details.vulns.has(key) ? details.vulns.get(key) ?? null : null,
    };
    return evaluatePackage(r, data, details.advisories, now);
  });

  const { score, label } = computeScore(packages);
  const counts = computeCounts(packages);
  const plan = buildPlan(packages, replacements);
  const allVulnsFixable = packages.every((p) => p.vulns.every((v) => v.fixedIn !== null));
  const partial: SourceName[] = [];
  if (npmDown) partial.push('npm');
  for (const s of ['downloads', 'osv', 'deps.dev'] as const) if (details.unavailable.has(s)) partial.push(s);

  return { score, label, summary: buildSummary(counts, plan, allVulnsFixable, partial), counts, packages, plan, partial };
}
