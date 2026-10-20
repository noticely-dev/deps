import { describe, expect, it } from 'vitest';
import { computeCounts, computeScore } from '../../src/analyze/score.js';
import { pr } from '../helpers/package-result.js';

describe('computeScore', () => {
  it('is 100 and Healthy without risks or dependencies', () => {
    expect(computeScore([])).toEqual({ score: 100, label: 'Healthy' });
    expect(computeScore([pr()])).toEqual({ score: 100, label: 'Healthy' });
  });

  it('subtracts risk points, dev dependencies at half weight', () => {
    // 100 - 25 - 12 - 5*0.5 - 1 = 59.5 -> 60 (Needs attention)
    const pkgs = [pr({ risk: 'critical' }), pr({ risk: 'high' }), pr({ risk: 'medium', scope: 'dev' }), pr({ risk: 'low' })];
    expect(computeScore(pkgs)).toEqual({ score: 60, label: 'Needs attention' });
  });

  it('ignores packages that were not checked and clamps at 0', () => {
    expect(computeScore([pr({ risk: 'critical', status: 'not-found' })]).score).toBe(100);
    expect(computeScore(Array.from({ length: 5 }, () => pr({ risk: 'critical' })))).toEqual({ score: 0, label: 'At risk' });
  });

  it('caps maintenance-only deductions at 30 points', () => {
    const idle = () => pr({ risk: 'medium', findings: [{ kind: 'idle', risk: 'medium', text: '' }, { kind: 'single-maintainer', risk: 'medium', text: '' }] });
    expect(computeScore(Array.from({ length: 16 }, idle))).toEqual({ score: 70, label: 'Needs attention' });
    // Below the cap, maintenance counts in full: 4 x 5 + 1 low major = 21.
    const few = [...Array.from({ length: 4 }, idle), pr({ risk: 'low', findings: [{ kind: 'majors-behind', risk: 'low', text: '' }] })];
    expect(computeScore(few).score).toBe(79);
  });

  it('keeps security findings uncapped and counts only the maintenance part above them', () => {
    const vulnIdle = pr({ risk: 'medium', findings: [{ kind: 'vulnerability', risk: 'low', text: '' }, { kind: 'idle', risk: 'medium', text: '' }] });
    const deprecated = pr({ risk: 'high', findings: [{ kind: 'deprecated', risk: 'high', text: '' }, { kind: 'idle', risk: 'medium', text: '' }] });
    // Each vulnIdle: 1 security + 4 maintenance; 10 of them = 10 + min(40, 30); deprecated adds 12 security.
    expect(computeScore([...Array.from({ length: 10 }, () => vulnIdle), deprecated])).toEqual({ score: 48, label: 'At risk' });
  });
});

describe('computeCounts', () => {
  it('counts vulnerabilities, deprecations, maintenance and majors', () => {
    const c = computeCounts([
      pr({ vulns: [{ id: 'a', risk: 'critical', summary: '', fixedIn: null }, { id: 'b', risk: 'low', summary: '', fixedIn: null }] }),
      pr({ findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ findings: [{ kind: 'idle', risk: 'medium', text: '' }, { kind: 'single-maintainer', risk: 'medium', text: '' }] }),
      pr({ majorsBehind: 2 }),
      pr({ status: 'not-found', majorsBehind: null }),
    ]);
    expect(c).toEqual({ total: 5, checked: 4, vulnerabilities: 2, criticalVulns: 1, deprecated: 1, maintenance: 1, majorsBehind: 1 });
  });
});
