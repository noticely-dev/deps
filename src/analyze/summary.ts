import { formatEffort } from './plan.js';
import type { Counts, Plan, SourceName } from './types.js';

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function buildSummary(counts: Counts, plan: Plan, allVulnsFixable: boolean, partial: SourceName[] = []): string {
  if (counts.total === 0) return 'No dependencies to check.';
  if (counts.checked === 0) {
    return `None of the ${n(counts.total, 'dependency', 'dependencies')} could be checked against the public npm registry.`;
  }
  const osvDown = partial.includes('osv');
  // With OSV missing, zero vulnerabilities means "unknown", never "none" (spec §4.4).
  const osvNote = !osvDown ? '' : counts.vulnerabilities > 0
    ? ' Vulnerability data was incomplete for this check.'
    : ' Vulnerability data was unavailable for this check.';
  const parts: string[] = [];
  if (counts.vulnerabilities > 0) {
    let s = n(counts.vulnerabilities, 'known vulnerability', 'known vulnerabilities');
    if (counts.criticalVulns > 0) s += ` (${counts.criticalVulns} critical)`;
    if (allVulnsFixable) s += ' with available fixes';
    parts.push(s);
  }
  if (counts.deprecated > 0) parts.push(n(counts.deprecated, 'deprecated package', 'deprecated packages'));
  if (counts.maintenance > 0) parts.push(`${n(counts.maintenance, 'package', 'packages')} with maintenance risk`);
  if (counts.majorsBehind > 0) parts.push(`${n(counts.majorsBehind, 'package', 'packages')} at least one major version behind`);

  if (parts.length === 0) {
    const notChecked = counts.total - counts.checked;
    const clean = osvDown ? 'nothing deprecated or abandoned' : 'no known vulnerabilities, nothing deprecated or abandoned';
    let text: string;
    if (partial.length) text = `No problems found in the ${n(counts.checked, 'checked dependency', 'checked dependencies')}: ${clean}.`;
    else if (counts.checked === 1) text = `The 1 checked dependency looks healthy: ${clean}.`;
    else text = `${notChecked ? 'The' : 'All'} ${counts.checked} checked dependencies look healthy: ${clean}.`;
    if (notChecked) text += ` ${n(notChecked, 'other dependency', 'other dependencies')} could not be checked.`;
    return text + osvNote;
  }
  let text = `${joinList(parts)}.${osvNote}`;
  if (plan.totalMaxHours > 0) text += ` Working through the upgrade plan takes an estimated ${formatEffort(plan.totalMinHours, plan.totalMaxHours)}.`;
  return text;
}
