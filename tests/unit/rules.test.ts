import { describe, expect, it } from 'vitest';
import { evaluatePackage, fixedVersionFor } from '../../src/analyze/rules.js';
import type { Advisory, NpmInfo, PackageData, ResolvedDep } from '../../src/analyze/types.js';

const now = new Date('2026-10-12T00:00:00Z');
const npm = (o: Partial<NpmInfo> = {}): NpmInfo => ({
  found: true, latest: '2.0.0', distTags: { latest: '2.0.0' }, versions: ['1.0.0', '2.0.0'],
  lastPublish: '2026-06-01T00:00:00Z', maintainers: 3, deprecatedLatest: null, deprecated: {}, ...o,
});
const data = (o: Partial<PackageData> = {}): PackageData => ({
  npm: npm(), downloads: 1000, depsdev: { repo: 'github.com/a/b', scorecard: 7.5, stars: 10 }, vulnIds: [], ...o,
});
const dep = (o: Partial<ResolvedDep> = {}): ResolvedDep => ({
  name: 'pkg', spec: '^2.0.0', scope: 'prod', lockVersion: null, resolved: '2.0.0', resolution: 'lockfile', ...o,
});
const lodashAdv: Advisory = {
  id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
  npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] },
};

describe('fixedVersionFor', () => {
  it('finds the fixing version for the affected range', () => {
    expect(fixedVersionFor(lodashAdv, 'lodash', '4.17.15')).toBe('4.17.21');
    expect(fixedVersionFor(lodashAdv, 'lodash', '4.17.21')).toBeNull();
    expect(fixedVersionFor({ ...lodashAdv, npmRanges: { x: [[{ introduced: '0' }, { last_affected: '1.0.0' }]] } }, 'x', '0.5.0')).toBeNull();
  });
});

describe('evaluatePackage', () => {
  it('marks a healthy package', () => {
    const r = evaluatePackage(dep(), data(), new Map(), now);
    expect(r).toMatchObject({ status: 'checked', risk: 'healthy', findings: [], scorecard: 7.5, downloads: 1000, worstCase: false });
  });

  it('maps advisories to vulnerabilities with fix versions', () => {
    const r = evaluatePackage(
      dep({ name: 'lodash', resolved: '4.17.15', resolution: 'range-min' }),
      data({ npm: npm({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }), vulnIds: ['GHSA-35jh-r3h4-6jhm', 'GHSA-unknown'] }),
      new Map([[lodashAdv.id, lodashAdv]]), now);
    expect(r.vulns).toEqual([
      { id: 'GHSA-35jh-r3h4-6jhm', risk: 'high', summary: 'Command Injection in lodash', fixedIn: '4.17.21' },
      { id: 'GHSA-unknown', risk: 'medium', summary: 'Details unavailable', fixedIn: null },
    ]);
    expect(r.findings[0]).toEqual({ kind: 'vulnerability', risk: 'high', text: '2 known vulnerabilities' });
    expect(r.risk).toBe('high');
    expect(r.worstCase).toBe(true);
  });

  it('flags a deprecated package as high and a deprecated version as medium', () => {
    const whole = evaluatePackage(dep(), data({ npm: npm({ deprecatedLatest: 'use undici', deprecated: { '2.0.0': 'use undici' } }) }), new Map(), now);
    expect(whole.risk).toBe('high');
    expect(whole.deprecated).toBe('use undici');
    const version = evaluatePackage(dep({ resolved: '1.0.0' }), data({ npm: npm({ deprecated: { '1.0.0': 'bug, upgrade' } }) }), new Map(), now);
    expect(version.findings.map((f) => [f.kind, f.risk])).toContainEqual(['version-deprecated', 'medium']);
  });

  it('flags idle and single-maintainer packages', () => {
    const r = evaluatePackage(dep(), data({ npm: npm({ lastPublish: '2018-04-01T00:00:00Z', maintainers: 1 }) }), new Map(), now);
    expect(r.findings.map((f) => [f.kind, f.risk])).toEqual([['idle', 'medium'], ['single-maintainer', 'medium']]);
    expect(r.findings[0]?.text).toBe('No release for 8 years');
    const single = evaluatePackage(dep(), data({ npm: npm({ maintainers: 1 }) }), new Map(), now);
    expect(single.findings).toEqual([{ kind: 'single-maintainer', risk: 'low', text: 'Single maintainer' }]);
  });

  it('counts major versions behind', () => {
    const two = evaluatePackage(dep({ resolved: '6.12.0' }), data({ npm: npm({ latest: '8.19.1' }) }), new Map(), now);
    expect(two).toMatchObject({ majorsBehind: 2, risk: 'low' });
    const three = evaluatePackage(dep({ resolved: '1.0.0' }), data({ npm: npm({ latest: '4.0.0' }) }), new Map(), now);
    expect(three.risk).toBe('medium');
  });

  it('skips the single-maintainer and majors-behind findings for @types packages', () => {
    const types = evaluatePackage(dep({ name: '@types/node', resolved: '20.1.0' }),
      data({ npm: npm({ latest: '24.19.0', maintainers: 1 }) }), new Map(), now);
    expect(types).toMatchObject({ findings: [], risk: 'healthy', majorsBehind: null });
    // Vulnerability, deprecation and idle rules still apply.
    const old = evaluatePackage(dep({ name: '@types/x', resolved: '1.0.0' }),
      data({ npm: npm({ latest: '1.0.0', lastPublish: '2018-04-01T00:00:00Z', maintainers: 1, deprecated: { '1.0.0': 'types now bundled' } }) }), new Map(), now);
    expect(old.findings.map((f) => f.kind)).toEqual(['version-deprecated', 'idle']);
  });

  it('marks only real ranges resolved to their lowest version as worst case', () => {
    expect(evaluatePackage(dep({ spec: '^2.0.0', resolution: 'range-min' }), data(), new Map(), now).worstCase).toBe(true);
    expect(evaluatePackage(dep({ spec: '2.0.0', resolution: 'range-min' }), data(), new Map(), now).worstCase).toBe(false);
    expect(evaluatePackage(dep({ spec: '^2.0.0', resolution: 'lockfile' }), data(), new Map(), now).worstCase).toBe(false);
  });

  it('reports packages that could not be checked', () => {
    expect(evaluatePackage(dep({ resolved: null, resolution: 'not-found' }), undefined, new Map(), now))
      .toMatchObject({ status: 'not-found', risk: 'healthy' });
    expect(evaluatePackage(dep({ resolved: null, resolution: 'unavailable' }), undefined, new Map(), now).status).toBe('unresolved');
  });
});
