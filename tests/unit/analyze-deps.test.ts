import { describe, expect, it } from 'vitest';
import { analyzeDeps } from '../../src/check/analyze-deps.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';

const now = new Date('2026-10-12T00:00:00Z');

describe('analyzeDeps', () => {
  it('produces a complete result', async () => {
    const sources = fakeSources({
      npm: {
        lodash: npmInfo({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }),
        express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }),
      },
      vulns: { 'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'] },
      advisories: { 'GHSA-35jh-r3h4-6jhm': { id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
        npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] } } },
    });
    const r = await analyzeDeps({ deps: [
      { name: 'express', spec: '^5.1.0', scope: 'prod', lockVersion: null },
      { name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null },
      { name: '@acme/private', spec: '^1.0.0', scope: 'prod', lockVersion: null },
    ] }, sources, {}, now);
    expect(r.score).toBe(88);
    expect(r.label).toBe('Healthy');
    expect(r.packages.map((p) => [p.name, p.status, p.risk])).toEqual([
      ['express', 'checked', 'healthy'], ['lodash', 'checked', 'high'], ['@acme/private', 'not-found', 'healthy'],
    ]);
    expect(r.plan.steps[0]?.action).toBe('Upgrade to 4.17.21');
    expect(r.summary).toBe('1 known vulnerability with available fixes. Working through the upgrade plan takes an estimated 15 min.');
    expect(r.partial).toEqual([]);
  });

  it('handles an empty dependency list', async () => {
    const r = await analyzeDeps({ deps: [] }, fakeSources(), {}, now);
    expect(r).toMatchObject({ score: 100, label: 'Healthy', summary: 'No dependencies to check.', packages: [] });
  });

  it('marks partial data when a source is unavailable', async () => {
    const r = await analyzeDeps({ deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] },
      fakeSources({ npm: { a: npmInfo() }, unavailable: ['osv'] }), {}, now);
    expect(r.partial).toEqual(['osv']);
    expect(r.packages[0]?.status).toBe('checked');
  });

  it('marks npm as partial when the registry is down', async () => {
    const r = await analyzeDeps({ deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] },
      fakeSources({ npmUnavailable: true }), {}, now);
    expect(r.partial).toEqual(['npm']);
    expect(r.packages[0]).toMatchObject({ status: 'unresolved', resolution: 'unavailable' });
  });
});
