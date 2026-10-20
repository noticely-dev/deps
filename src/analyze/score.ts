import { RISK_POINTS, worstRisk, type Counts, type FindingKind, type PackageResult, type ScoreLabel } from './types.js';

/** Maintenance-only findings (quiet, small or outdated packages) can take at most this many points off in total. */
export const MAINTENANCE_CAP = 30;
const MAINTENANCE_KINDS: ReadonlySet<FindingKind> = new Set(['idle', 'single-maintainer', 'majors-behind']);

export function computeScore(pkgs: PackageResult[]): { score: number; label: ScoreLabel } {
  let security = 0;
  let maintenance = 0;
  for (const p of pkgs) {
    if (p.status !== 'checked') continue;
    const weight = p.scope === 'dev' ? 0.5 : 1;
    // A package costs the points of its worst finding; the part above its worst security finding is maintenance.
    const securityPoints = RISK_POINTS[worstRisk(p.findings.filter((f) => !MAINTENANCE_KINDS.has(f.kind)).map((f) => f.risk))];
    const maintenancePoints = RISK_POINTS[worstRisk(p.findings.filter((f) => MAINTENANCE_KINDS.has(f.kind)).map((f) => f.risk))];
    const extra = Math.max(0, maintenancePoints - securityPoints);
    security += (RISK_POINTS[p.risk] - extra) * weight;
    maintenance += extra * weight;
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - security - Math.min(maintenance, MAINTENANCE_CAP))));
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
