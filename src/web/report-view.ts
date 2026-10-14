import { formatEffort } from '../analyze/plan.js';
import { RISK_ORDER, type PackageResult, type Risk } from '../analyze/types.js';
import type { ReportDoc } from '../store/reports.js';
import { formatDateTime, formatDownloads, formatMonth, ringDash, scorecardBar } from './format.js';

const RISK_LABEL: Record<Risk, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', healthy: 'Healthy' };
const SOURCE_LABEL: Record<string, string> = { npm: 'npm registry', downloads: 'npm download counts', osv: 'OSV.dev vulnerabilities', 'deps.dev': 'deps.dev scorecards' };

function reason(p: PackageResult): string {
  if (p.status === 'not-found') return "Not on the public npm registry (private packages aren't checked)";
  if (p.status === 'unresolved') {
    if (p.resolution === 'no-match') return 'No published version matches this range';
    if (p.resolution === 'invalid-spec') return 'Not a valid version range';
    return 'npm registry unavailable, try again later';
  }
  if (p.findings.length === 0) return p.latest === p.resolved ? 'Up to date' : 'No known issues';
  return p.findings.map((f) => f.text).join(' · ');
}

function kinds(p: PackageResult): string {
  const k = new Set<string>();
  for (const f of p.findings) {
    if (f.kind === 'vulnerability') k.add('vulnerable');
    if (f.kind === 'deprecated' || f.kind === 'version-deprecated') k.add('deprecated');
    if (f.kind === 'idle' || f.kind === 'single-maintainer') k.add('maintenance');
    if (f.kind === 'majors-behind') k.add('outdated');
  }
  return [...k].join(' ');
}

export function toReportView(doc: ReportDoc, publicUrl: string) {
  const r = doc.result;
  if (!r) throw new Error('report has no result');
  const sorted = [...r.packages].sort((a, b) =>
    Number(b.status === 'checked') - Number(a.status === 'checked') || RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.name.localeCompare(b.name));
  const ring = ringDash(r.score);
  return {
    id: doc._id,
    projectName: doc.projectName,
    depCount: r.counts.total,
    prodCount: r.packages.filter((p) => p.scope === 'prod').length,
    devCount: r.packages.filter((p) => p.scope === 'dev').length,
    checkedAt: formatDateTime(doc.finishedAt ?? doc.createdAt),
    shareUrl: `${publicUrl}/r/${doc._id}`,
    hasLockfile: doc.hasLockfile,
    score: r.score,
    label: r.label,
    ringClass: r.label === 'Healthy' ? 'healthy' : r.label === 'Needs attention' ? 'attention' : 'risk',
    ring,
    summary: r.summary,
    counts: r.counts,
    // Without OSV data a zero would read as "no vulnerabilities".
    vulnKpi: r.partial.includes('osv') ? '—' : String(r.counts.vulnerabilities),
    partial: r.partial.length ? `Partial data: ${r.partial.map((s) => SOURCE_LABEL[s] ?? s).join(', ')} could not be reached. The score excludes the missing data. Re-run the check later for complete results.` : null,
    rows: sorted.map((p, i) => ({
      idx: i, name: p.name, scope: p.scope, risk: p.status === 'checked' ? p.risk : 'none',
      riskLabel: p.status === 'checked' ? RISK_LABEL[p.risk] : 'Not checked',
      version: p.resolved ?? p.spec, latest: p.latest ?? '—', lastRelease: formatMonth(p.lastPublish),
      maintainers: p.maintainers ?? '—', downloads: formatDownloads(p.downloads),
      scorecard: p.scorecard === null ? '—' : p.scorecard.toFixed(1), bar: scorecardBar(p.scorecard),
      reason: reason(p), kinds: kinds(p),
      worstCase: p.worstCase && p.risk !== 'healthy'
        ? (doc.hasLockfile ? 'not in your lockfile: lowest matching version checked' : 'may already be fixed, add your lockfile')
        : null,
      deprecated: p.deprecated,
      vulns: p.vulns.map((v) => ({ ...v, riskLabel: RISK_LABEL[v.risk], url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}` })),
      expandable: p.vulns.length > 0 || p.deprecated !== null,
    })),
    plan: r.plan.steps.map((s, i) => ({ n: i + 1, name: s.name, action: s.action, effort: s.effort === 'watch' ? 'monitor' : formatEffort(s.minHours, s.maxHours), risk: s.risk })),
    planTotal: r.plan.totalMaxHours > 0 ? formatEffort(r.plan.totalMinHours, r.plan.totalMaxHours) : null,
    skipped: doc.skipped,
    contactUrl: `/contact?r=${doc._id}`,
  };
}

export type ReportView = ReturnType<typeof toReportView>;

const cell = (s: string | number | null) => String(s ?? '—').replace(/[|\r\n]+/g, ' ');

export function toMarkdown(doc: ReportDoc, publicUrl: string): string {
  const v = toReportView(doc, publicUrl);
  const lines = [
    `# Dependency health: ${cell(v.projectName)}`,
    '',
    `**Score ${v.score}/100 (${v.label})** · checked ${v.checkedAt} · [full report](${v.shareUrl})`,
    '',
    ...(v.partial ? [`> ${v.partial}`, ''] : []),
    v.summary,
    '',
    '| Package | In use | Latest | Risk | Notes |',
    '|---|---|---|---|---|',
    ...v.rows.map((r) => `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.latest)} | ${r.riskLabel} | ${cell(r.reason)} |`),
  ];
  if (v.plan.length) {
    lines.push('', '## Upgrade order', '', ...v.plan.map((s) => `${s.n}. **${cell(s.name)}**: ${cell(s.action)} (${s.effort})`));
    if (v.planTotal) lines.push('', `Total estimate: ${v.planTotal}`);
  }
  lines.push('', `_Generated by [noticely/deps](${publicUrl}). Data: npm registry, OSV.dev, deps.dev._`, '');
  return lines.join('\n');
}
