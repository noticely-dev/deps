import semver from 'semver';
import { worstRisk, type Advisory, type Finding, type PackageData, type PackageResult, type ResolvedDep, type Risk, type VulnResult } from './types.js';

export const IDLE_DAYS = 730;
const DAY_MS = 86_400_000;

const SEVERITY_RISK: Record<NonNullable<Advisory['severity']>, Risk> = {
  CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', LOW: 'low',
};

export function fixedVersionFor(adv: Advisory, name: string, version: string): string | null {
  const ranges = Object.hasOwn(adv.npmRanges, name) ? adv.npmRanges[name] ?? [] : [];
  let best: string | null = null;
  for (const events of ranges) {
    let introduced = '0';
    for (const ev of events) {
      if (ev.introduced !== undefined) introduced = ev.introduced;
      if (ev.fixed && semver.valid(ev.fixed)) {
        const afterStart = introduced === '0' || (semver.valid(introduced) !== null && semver.gte(version, introduced));
        if (afterStart && semver.lt(version, ev.fixed) && (best === null || semver.lt(ev.fixed, best))) best = ev.fixed;
      }
    }
  }
  return best;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function evaluatePackage(
  dep: ResolvedDep, data: PackageData | undefined, advisories: Map<string, Advisory>, now: Date,
): PackageResult {
  const npm = data?.npm;
  const base: PackageResult = {
    name: dep.name, scope: dep.scope, spec: dep.spec, resolved: dep.resolved, resolution: dep.resolution,
    status: 'checked', latest: npm?.latest ?? null, lastPublish: npm?.lastPublish ?? null,
    maintainers: npm?.found ? npm.maintainers : null, downloads: data?.downloads ?? null,
    scorecard: data?.depsdev?.scorecard ?? null, stars: data?.depsdev?.stars ?? null,
    deprecated: null, vulns: [], findings: [], risk: 'healthy', majorsBehind: null,
    // An exact version spec resolves to itself: nothing a lockfile could change.
    worstCase: dep.resolution === 'range-min' && semver.valid(dep.spec.trim()) === null,
  };
  if (dep.resolution === 'not-found') return { ...base, status: 'not-found' };
  if (!dep.resolved || !npm?.found) return { ...base, status: 'unresolved' };
  const version = dep.resolved;
  const findings: Finding[] = [];

  // Vulnerabilities
  const vulns: VulnResult[] = (data?.vulnIds ?? []).map((id) => {
    const adv = advisories.get(id);
    if (!adv) return { id, risk: 'medium', summary: 'Details unavailable', fixedIn: null };
    return {
      id, risk: adv.severity ? SEVERITY_RISK[adv.severity] : 'medium',
      summary: adv.summary, fixedIn: fixedVersionFor(adv, dep.name, version),
    };
  });
  if (vulns.length) {
    findings.push({ kind: 'vulnerability', risk: worstRisk(vulns.map((v) => v.risk)), text: plural(vulns.length, 'known vulnerability', 'known vulnerabilities') });
  }

  // Deprecation
  let deprecated: string | null = null;
  if (npm.deprecatedLatest) {
    deprecated = npm.deprecatedLatest;
    findings.push({ kind: 'deprecated', risk: 'high', text: 'Deprecated by its authors' });
  } else if (Object.hasOwn(npm.deprecated, version)) {
    deprecated = npm.deprecated[version] ?? null;
    findings.push({ kind: 'version-deprecated', risk: 'medium', text: `Version ${version} is deprecated` });
  }

  // DefinitelyTyped: every @types package lists one maintainer ("types"), and its major follows the runtime or library.
  const typesPkg = dep.name.startsWith('@types/');

  // Maintenance
  const idleDays = npm.lastPublish ? (now.getTime() - Date.parse(npm.lastPublish)) / DAY_MS : 0;
  const idle = idleDays > IDLE_DAYS;
  if (idle) findings.push({ kind: 'idle', risk: 'medium', text: `No release for ${Math.floor(idleDays / 365)} years` });
  if (npm.maintainers === 1 && !typesPkg) findings.push({ kind: 'single-maintainer', risk: idle ? 'medium' : 'low', text: 'Single maintainer' });

  // Majors behind
  let majorsBehind: number | null = null;
  if (!typesPkg && npm.latest && semver.valid(npm.latest) && semver.valid(version)) {
    majorsBehind = Math.max(0, semver.major(npm.latest) - semver.major(version));
    if (majorsBehind >= 1) {
      findings.push({ kind: 'majors-behind', risk: majorsBehind >= 3 ? 'medium' : 'low', text: `${plural(majorsBehind, 'major version', 'major versions')} behind` });
    }
  }

  return { ...base, deprecated, vulns, findings, majorsBehind, risk: worstRisk(findings.map((f) => f.risk)) };
}
