import { describe, expect, it } from 'vitest';
import { buildPlan, formatEffort } from '../../src/analyze/plan.js';
import { loadReplacements } from '../../src/analyze/replacements.js';
import { pr } from '../helpers/package-result.js';

const repl = { request: { suggestion: 'native fetch or undici', effort: 'replace' as const }, 'node-uuid': { suggestion: 'uuid', effort: 'rename' as const } };

describe('formatEffort', () => {
  it.each([
    [0.25, 0.25, '15 min'], [0.5, 0.5, '30 min'], [0, 0, 'no work'], [2, 3, '2–3 h'],
    [4, 8, '0.5–1 day'], [20, 36, '2.5–4.5 days'], [8, 8, '1 day'],
  ])('%d–%d h → %s', (min, max, out) => expect(formatEffort(min, max)).toBe(out));
});

describe('buildPlan', () => {
  it('orders by risk removed per hour and totals the estimates', () => {
    const plan = buildPlan([
      pr({ name: 'express', risk: 'healthy' }),
      pr({ name: 'mongoose', resolved: '6.12.0', latest: '8.19.1', majorsBehind: 2, risk: 'low', findings: [{ kind: 'majors-behind', risk: 'low', text: '' }] }),
      pr({ name: 'request', risk: 'high', deprecated: 'deprecated', findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ name: 'node-uuid', risk: 'high', deprecated: 'renamed', findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ name: 'lodash', resolved: '4.17.15', risk: 'high', vulns: [
        { id: 'a', risk: 'high', summary: '', fixedIn: '4.17.21' }, { id: 'b', risk: 'medium', summary: '', fixedIn: '4.17.16' }],
        findings: [{ kind: 'vulnerability', risk: 'high', text: '' }] }),
      pr({ name: 'left-pad', risk: 'low', findings: [{ kind: 'single-maintainer', risk: 'low', text: '' }] }),
    ], repl);
    expect(plan.steps.map((s) => [s.name, s.action, s.effort])).toEqual([
      ['lodash', 'Upgrade to 4.17.21', 'patch'],
      ['node-uuid', 'Replace with uuid', 'rename'],
      ['request', 'Replace with native fetch or undici', 'replace'],
      ['mongoose', 'Upgrade to 8.19.1', 'major'],
      ['left-pad', 'Keep an eye on it (single maintainer)', 'watch'],
    ]);
    expect(plan.steps[3]).toMatchObject({ minHours: 8, maxHours: 12 });
    expect([plan.totalMinHours, plan.totalMaxHours]).toEqual([12.75, 20.75]);
  });

  it('suggests replacing when no fix exists and handles an empty input', () => {
    const plan = buildPlan([pr({ name: 'x', risk: 'critical', vulns: [{ id: 'a', risk: 'critical', summary: '', fixedIn: null }],
      findings: [{ kind: 'vulnerability', risk: 'critical', text: '' }] })], {});
    expect(plan.steps[0]).toMatchObject({ action: 'Replace or mitigate — no fixed version yet', effort: 'replace' });
    expect(buildPlan([], {})).toEqual({ steps: [], totalMinHours: 0, totalMaxHours: 0 });
  });
});

it('loads the bundled replacements file', () => {
  const r = loadReplacements('data/replacements.json');
  expect(r['node-uuid']).toEqual({ suggestion: 'uuid', effort: 'rename' });
  expect(Object.getPrototypeOf(r)).toBeNull();
});
