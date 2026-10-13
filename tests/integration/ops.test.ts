import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSample } from '../../src/check/sample.js';
import { createMetrics } from '../../src/metrics.js';
import { getReport, upsertSampleReport } from '../../src/store/reports.js';
import { testApp } from '../helpers/app.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ sources: fakeSources({ npm: { express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }) } }) }); });
afterAll(async () => t.close());

describe('ops', () => {
  it('reports health', async () => {
    const res = await t.app.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('serves metrics', async () => {
    const res = await t.app.inject({ url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('deps_checks_total');
  });

  it('builds the sample once and rebuilds it when stale', async () => {
    const now = new Date();
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(true);
    await t.runner.idle();
    expect(await getReport(t.db, 'sample')).toMatchObject({ status: 'done', projectName: 'acme-shop-api' });
    expect((await getReport(t.db, 'sample'))?.expiresAt).toBeUndefined();
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(false);
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', new Date(now.getTime() + 25 * 3_600_000))).toBe(true);
    await t.runner.idle();
    const res = await t.app.inject({ url: '/sample' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/r/sample');
  });

  it('rebuilds a sample left running for more than 3 minutes', async () => {
    const now = new Date();
    await upsertSampleReport(t.db, { projectName: 'stuck', hasLockfile: false, deps: [], skipped: [] }, new Date(now.getTime() - 2 * 60_000));
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(false);
    await upsertSampleReport(t.db, { projectName: 'stuck', hasLockfile: false, deps: [], skipped: [] }, new Date(now.getTime() - 4 * 60_000));
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(true);
    await t.runner.idle();
    expect(await getReport(t.db, 'sample')).toMatchObject({ status: 'done', projectName: 'acme-shop-api' });
  });

  it('exposes Prometheus metrics with the expected names', async () => {
    const m = createMetrics();
    m.app.limited('check');
    m.app.confirmed('pdf');
    m.sources.request('npm', 'ok', 0.12);
    m.sources.cache(true);
    m.checks.finished('done', 1.5);
    const text = await m.registry.metrics();
    for (const name of ['deps_checks_total{result="done"} 1', 'deps_rate_limited_total{kind="check"} 1', 'deps_signups_confirmed_total{list="pdf"} 1',
      'deps_upstream_requests_total{source="npm",outcome="ok"} 1', 'deps_cache_lookups_total{result="hit"} 1']) {
      expect(text).toContain(name);
    }
  });
});
