import { describe, expect, it } from 'vitest';
import { buildSummary } from '../../src/analyze/summary.js';
import type { Counts } from '../../src/analyze/types.js';

const counts = (o: Partial<Counts> = {}): Counts => ({
  total: 12, checked: 12, vulnerabilities: 0, criticalVulns: 0, deprecated: 0, maintenance: 0, majorsBehind: 0, ...o,
});
const noPlan = { steps: [], totalMinHours: 0, totalMaxHours: 0 };

describe('buildSummary', () => {
  it('handles nothing to check', () => {
    expect(buildSummary(counts({ total: 0, checked: 0 }), noPlan, true)).toBe('No dependencies to check.');
    expect(buildSummary(counts({ total: 3, checked: 0 }), noPlan, true))
      .toBe('None of the 3 dependencies could be checked against the public npm registry.');
  });

  it('reports a healthy project', () => {
    expect(buildSummary(counts(), noPlan, true))
      .toBe('All 12 checked dependencies look healthy: no known vulnerabilities, nothing deprecated or abandoned.');
  });

  it('pluralizes a single healthy dependency', () => {
    expect(buildSummary(counts({ total: 1, checked: 1 }), noPlan, true))
      .toBe('The 1 checked dependency looks healthy: no known vulnerabilities, nothing deprecated or abandoned.');
  });

  it('does not claim all are healthy when some could not be checked', () => {
    expect(buildSummary(counts({ total: 12, checked: 10 }), noPlan, true))
      .toBe('The 10 checked dependencies look healthy: no known vulnerabilities, nothing deprecated or abandoned. 2 other dependencies could not be checked.');
  });

  it('never claims no vulnerabilities when OSV data is missing', () => {
    expect(buildSummary(counts(), noPlan, true, ['osv']))
      .toBe('No problems found in the 12 checked dependencies: nothing deprecated or abandoned. Vulnerability data was unavailable for this check.');
    expect(buildSummary(counts({ deprecated: 1 }), noPlan, true, ['osv']))
      .toBe('1 deprecated package. Vulnerability data was unavailable for this check.');
    expect(buildSummary(counts({ vulnerabilities: 2 }), noPlan, true, ['osv']))
      .toBe('2 known vulnerabilities with available fixes. Vulnerability data was incomplete for this check.');
  });

  it('does not claim all are healthy when another source is missing', () => {
    expect(buildSummary(counts({ checked: 11 }), noPlan, true, ['npm', 'deps.dev']))
      .toBe('No problems found in the 11 checked dependencies: no known vulnerabilities, nothing deprecated or abandoned. 1 other dependency could not be checked.');
  });

  it('lists the problems and the plan estimate', () => {
    const plan = { steps: [{ name: 'a', scope: 'prod' as const, risk: 'high' as const, action: '', effort: 'patch' as const, minHours: 8, maxHours: 12 }], totalMinHours: 8, totalMaxHours: 12 };
    expect(buildSummary(counts({ vulnerabilities: 7, criticalVulns: 1, deprecated: 2, maintenance: 3, majorsBehind: 5 }), plan, true))
      .toBe('7 known vulnerabilities (1 critical) with available fixes, 2 deprecated packages, 3 packages with maintenance risk and 5 packages at least one major version behind. Working through the upgrade plan takes an estimated 1–1.5 days.');
    expect(buildSummary(counts({ vulnerabilities: 1 }), plan, false))
      .toBe('1 known vulnerability. Working through the upgrade plan takes an estimated 1–1.5 days.');
  });
});
