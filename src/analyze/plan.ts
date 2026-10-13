import semver from 'semver';
import { RISK_ORDER, RISK_POINTS, type EffortClass, type PackageResult, type Plan, type PlanStep, type Replacement } from './types.js';

function hours(effort: EffortClass, majors = 1): [number, number] {
  switch (effort) {
    case 'patch': return [0.25, 0.25];
    case 'rename': return [0.5, 0.5];
    case 'major': return [4 + 4 * (majors - 1), 8 + 4 * (majors - 1)];
    case 'replace': return [4, 8];
    case 'watch': return [0, 0];
  }
}

function upgradeEffort(from: string | null, to: string): { effort: EffortClass; majors: number } {
  if (!from || !semver.valid(from) || !semver.valid(to)) return { effort: 'major', majors: 1 };
  const majors = semver.major(to) - semver.major(from);
  return majors >= 1 ? { effort: 'major', majors } : { effort: 'patch', majors: 0 };
}

function stepFor(p: PackageResult, replacements: Record<string, Replacement>): Omit<PlanStep, 'minHours' | 'maxHours'> & { majors: number } | null {
  const kinds = new Set(p.findings.map((f) => f.kind));
  const repl = Object.hasOwn(replacements, p.name) ? replacements[p.name] : undefined;
  const base = { name: p.name, scope: p.scope, risk: p.risk };
  if (kinds.has('deprecated')) {
    return repl
      ? { ...base, action: `Replace with ${repl.suggestion}`, effort: repl.effort, majors: 1 }
      : { ...base, action: `Replace ${p.name} (deprecated)`, effort: 'replace', majors: 1 };
  }
  if (p.vulns.length) {
    const fixes = p.vulns.map((v) => v.fixedIn).filter((v): v is string => v !== null);
    if (fixes.length < p.vulns.length || fixes.length === 0) {
      return { ...base, action: 'Replace or mitigate — no fixed version yet', effort: 'replace', majors: 1 };
    }
    const target = fixes.reduce((a, b) => (semver.gt(b, a) ? b : a));
    const { effort, majors } = upgradeEffort(p.resolved, target);
    return { ...base, action: `Upgrade to ${target}`, effort, majors };
  }
  if ((kinds.has('version-deprecated') || kinds.has('majors-behind')) && p.latest) {
    const { effort, majors } = upgradeEffort(p.resolved, p.latest);
    return { ...base, action: `Upgrade to ${p.latest}`, effort, majors };
  }
  if (kinds.has('idle') || kinds.has('single-maintainer')) {
    if (repl) return { ...base, action: `Replace with ${repl.suggestion}`, effort: repl.effort, majors: 1 };
    if (p.risk === 'low') return { ...base, action: 'Keep an eye on it (single maintainer)', effort: 'watch', majors: 0 };
    return { ...base, action: 'Review for a maintained alternative', effort: 'replace', majors: 1 };
  }
  return null;
}

export function buildPlan(pkgs: PackageResult[], replacements: Record<string, Replacement>): Plan {
  const steps: PlanStep[] = [];
  for (const p of pkgs) {
    if (p.status !== 'checked' || p.risk === 'healthy') continue;
    const s = stepFor(p, replacements);
    if (!s) continue;
    const [minHours, maxHours] = hours(s.effort, s.majors);
    steps.push({ name: s.name, scope: s.scope, risk: s.risk, action: s.action, effort: s.effort, minHours, maxHours });
  }
  const value = (s: PlanStep) => {
    if (s.effort === 'watch') return -1;
    return (RISK_POINTS[s.risk] * (s.scope === 'dev' ? 0.5 : 1)) / Math.max((s.minHours + s.maxHours) / 2, 0.25);
  };
  steps.sort((a, b) => value(b) - value(a) || RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.name.localeCompare(b.name));
  return {
    steps,
    totalMinHours: steps.reduce((n, s) => n + s.minHours, 0),
    totalMaxHours: steps.reduce((n, s) => n + s.maxHours, 0),
  };
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function formatEffort(minHours: number, maxHours: number): string {
  if (maxHours === 0) return 'no work';
  if (maxHours < 1) {
    const a = Math.round(minHours * 60), b = Math.round(maxHours * 60);
    return a === b ? `${b} min` : `${a}–${b} min`;
  }
  if (maxHours < 4) return minHours === maxHours ? `${trim(maxHours)} h` : `${trim(minHours)}–${trim(maxHours)} h`;
  const a = minHours / 8, b = maxHours / 8;
  const unit = b <= 1 ? 'day' : 'days';
  return a === b ? `${trim(b)} ${unit}` : `${trim(a)}–${trim(b)} ${unit}`;
}
