export type Scope = 'prod' | 'dev';
export type Risk = 'critical' | 'high' | 'medium' | 'low' | 'healthy';
export type Resolution =
  | 'lockfile' | 'range-min' | 'tag' | 'not-found' | 'no-match' | 'invalid-spec' | 'unavailable';
export type SourceName = 'npm' | 'downloads' | 'osv' | 'deps.dev';
export type EffortClass = 'patch' | 'rename' | 'major' | 'replace' | 'watch';

/** A dependency as stored on the report (from package.json + optional lockfile). */
export interface StoredDep {
  name: string;
  spec: string;
  scope: Scope;
  lockVersion: string | null;
}

export interface SkippedDep {
  name: string;
  spec: string;
  scope: Scope;
  reason: string;
}

export interface ParsedInput {
  projectName: string;
  hasLockfile: boolean;
  deps: StoredDep[];
  skipped: SkippedDep[];
}

export interface ResolvedDep extends StoredDep {
  resolved: string | null;
  resolution: Resolution;
}

export interface NpmInfo {
  found: boolean;
  latest: string | null;
  distTags: Record<string, string>;
  versions: string[];
  lastPublish: string | null; // ISO date of the most recent version publish
  maintainers: number;
  deprecatedLatest: string | null;
  deprecated: Record<string, string>; // version -> message (only deprecated versions)
}

export interface DepsDevInfo {
  repo: string | null;
  scorecard: number | null;
  stars: number | null;
}

export interface RangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface Advisory {
  id: string;
  summary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | null;
  npmRanges: Record<string, RangeEvent[][]>; // npm package name -> list of SEMVER ranges (event lists)
}

export interface PackageData {
  npm: NpmInfo | undefined;
  downloads: number | null;
  depsdev: DepsDevInfo | null;
  vulnIds: string[] | null; // null = OSV unavailable for this package
}

export type FindingKind =
  | 'vulnerability' | 'deprecated' | 'version-deprecated' | 'idle' | 'single-maintainer' | 'majors-behind';

export interface Finding {
  kind: FindingKind;
  risk: Risk;
  text: string;
}

export interface VulnResult {
  id: string;
  risk: Risk;
  summary: string;
  fixedIn: string | null;
}

export interface PackageResult {
  name: string;
  scope: Scope;
  spec: string;
  resolved: string | null;
  resolution: Resolution;
  status: 'checked' | 'not-found' | 'unresolved';
  latest: string | null;
  lastPublish: string | null;
  maintainers: number | null;
  downloads: number | null;
  scorecard: number | null;
  stars: number | null;
  deprecated: string | null;
  vulns: VulnResult[];
  findings: Finding[];
  risk: Risk;
  majorsBehind: number | null;
  worstCase: boolean;
}

export interface Counts {
  total: number;
  checked: number;
  vulnerabilities: number;
  criticalVulns: number;
  deprecated: number;
  maintenance: number;
  majorsBehind: number;
}

export interface Replacement {
  suggestion: string;
  effort: EffortClass;
}

export interface PlanStep {
  name: string;
  scope: Scope;
  risk: Risk;
  action: string;
  effort: EffortClass;
  minHours: number;
  maxHours: number;
}

export interface Plan {
  steps: PlanStep[];
  totalMinHours: number;
  totalMaxHours: number;
}

export type ScoreLabel = 'Healthy' | 'Needs attention' | 'At risk';

export interface ReportResult {
  score: number;
  label: ScoreLabel;
  summary: string;
  counts: Counts;
  packages: PackageResult[];
  plan: Plan;
  partial: SourceName[];
}

export const RISK_ORDER: Record<Risk, number> = { critical: 4, high: 3, medium: 2, low: 1, healthy: 0 };
export const RISK_POINTS: Record<Risk, number> = { critical: 25, high: 12, medium: 5, low: 1, healthy: 0 };

export function worstRisk(risks: Risk[]): Risk {
  return risks.reduce<Risk>((w, r) => (RISK_ORDER[r] > RISK_ORDER[w] ? r : w), 'healthy');
}
