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
