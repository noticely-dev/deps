import { RISK_POINTS, type Counts, type PackageResult, type ScoreLabel } from './types.js';

export function computeScore(pkgs: PackageResult[]): { score: number; label: ScoreLabel } {
  let penalty = 0;
  for (const p of pkgs) {
    if (p.status !== 'checked') continue;
    penalty += RISK_POINTS[p.risk] * (p.scope === 'dev' ? 0.5 : 1);
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const label: ScoreLabel = score >= 85 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk';
  return { score, label };
}

export function computeCounts(pkgs: PackageResult[]): Counts {
  const checked = pkgs.filter((p) => p.status === 'checked');
  const has = (p: PackageResult, kinds: string[]) => p.findings.some((f) => kinds.includes(f.kind));
  return {
    total: pkgs.length,
    checked: checked.length,
    vulnerabilities: checked.reduce((n, p) => n + p.vulns.length, 0),
    criticalVulns: checked.reduce((n, p) => n + p.vulns.filter((v) => v.risk === 'critical').length, 0),
    deprecated: checked.filter((p) => has(p, ['deprecated', 'version-deprecated'])).length,
    maintenance: checked.filter((p) => has(p, ['idle', 'single-maintainer'])).length,
    majorsBehind: checked.filter((p) => (p.majorsBehind ?? 0) >= 1).length,
  };
}
