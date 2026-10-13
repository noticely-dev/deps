import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeDeps } from '../../src/check/analyze-deps.js';
import { newReportId } from '../../src/store/ids.js';
import { createReport, setReportFailed, setReportResult } from '../../src/store/reports.js';
import type { StoredDep } from '../../src/analyze/types.js';
import { testApp } from '../helpers/app.js';
import { OWNER_NAME_RE } from '../helpers/owner.js';
import { fakeSources, npmInfo, type FakeSourceData } from '../helpers/fakes.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const now = new Date('2026-10-12T18:42:00Z');
const sourceData: Partial<FakeSourceData> = {
  npm: {
    lodash: npmInfo({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }),
    request: npmInfo({ latest: '2.88.2', versions: ['2.88.2'], lastPublish: '2020-02-11T00:00:00Z',
      deprecatedLatest: '<script>alert(1)</script> use fetch', deprecated: { '2.88.2': '<script>alert(1)</script> use fetch' } }),
    vitest: npmInfo({ latest: '5.0.2', versions: ['5.0.2'] }),
  },
  vulns: { 'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'] },
  advisories: { 'GHSA-35jh-r3h4-6jhm': { id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
    npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] } } },
};
const sources = fakeSources(sourceData);

async function doneReport(deps: StoredDep[], projectName = 'acme-shop-api', unavailable: string[] = [], hasLockfile = false) {
  const id = newReportId();
  await createReport(t.db, { _id: id, projectName, hasLockfile, deps, skipped: [{ name: 'internal', spec: 'file:../x', scope: 'prod', reason: 'Not from the npm registry' }] }, now);
  const result = await analyzeDeps({ deps }, sources, {}, now);
  await setReportResult(t.db, id, { ...result, partial: unavailable as never });
  return id;
}

const deps: StoredDep[] = [
  { name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null },
  { name: 'request', spec: '^2.88.2', scope: 'prod', lockVersion: null },
  { name: 'vitest', spec: '^5.0.2', scope: 'dev', lockVersion: null },
];

describe('GET /r/:id', () => {
  it('renders the report with score, summary, plan and brand card', async () => {
    const id = await doneReport(deps);
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.statusCode).toBe(200);
    for (const s of ['acme-shop-api', 'Needs attention', 'Recommended upgrade order', 'Upgrade to 4.17.21',
      'GHSA-35jh-r3h4-6jhm', 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', 'may already be fixed',
      `/contact?r=${id}`, 'independent backend engineer', 'name="list" value="pdf"', 'Not from the npm registry']) {
      expect(res.body).toContain(s);
    }
    expect(res.body).not.toMatch(OWNER_NAME_RE);
  });

  it('puts the quote card and PDF box above the plan, with pagers for long lists', async () => {
    const id = await doneReport(deps);
    const body = (await t.app.inject({ url: `/r/${id}` })).body;
    const quote = body.indexOf('Get a fixed-price quote');
    const pdf = body.indexOf('Full PDF report');
    const plan = body.indexOf('Recommended upgrade order');
    expect(quote).toBeGreaterThan(-1);
    expect(quote).toBeLessThan(pdf);
    expect(pdf).toBeLessThan(plan);
    expect(body).toContain('data-pager="rows" hidden');
    expect(body).toContain('data-pager="plan" hidden');
    expect(body).toContain('class="step" data-step');
  });

  it('shows the worst-case note only for ranges, worded for a lockfile that lacks the dependency', async () => {
    const exact = await doneReport([{ name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null }]);
    expect((await t.app.inject({ url: `/r/${exact}` })).body).not.toContain('may already be fixed');
    const range: StoredDep[] = [{ name: 'request', spec: '^2.88.2', scope: 'prod', lockVersion: null }];
    expect((await t.app.inject({ url: `/r/${await doneReport(range)}` })).body).toContain('may already be fixed, add your lockfile');
    const notInLock = (await t.app.inject({ url: `/r/${await doneReport(range, 'p', [], true)}` })).body;
    expect(notInLock).toContain('not in your lockfile: lowest matching version checked');
    expect(notInLock).not.toContain('add your lockfile');
  });

  it('escapes hostile text from package.json and npm', async () => {
    const id = await doneReport(deps, '<img src=x onerror=alert(1)>');
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows the partial-data banner', async () => {
    const id = await doneReport(deps, 'p', ['osv']);
    expect((await t.app.inject({ url: `/r/${id}` })).body).toContain('Partial data');
  });

  it('does not claim missing vulnerability data is clean', async () => {
    const id = newReportId();
    const healthy: StoredDep[] = [{ name: 'vitest', spec: '5.0.2', scope: 'prod', lockVersion: null }];
    await createReport(t.db, { _id: id, projectName: 'p', hasLockfile: true, deps: healthy, skipped: [] }, now);
    await setReportResult(t.db, id, await analyzeDeps({ deps: healthy }, fakeSources({ ...sourceData, unavailable: ['osv'] }), {}, now));
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.body).toContain('Vulnerability data was unavailable for this check.');
    expect(res.body).not.toContain('no known vulnerabilities');
    expect(res.body).toContain('The score excludes the missing data.');
    expect(res.body).toMatch(/<div class="n crit">—<\/div><div class="l">Known vulnerabilities/);
    const md = (await t.app.inject({ url: `/r/${id}.md` })).body;
    expect(md).toContain('Partial data: OSV.dev vulnerabilities could not be reached.');
    expect(md).toContain('The score excludes the missing data.');
  });

  it('renders an empty project', async () => {
    const id = await doneReport([]);
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No dependencies to check.');
    expect(res.body).toContain('>100<');
  });

  it('shows progress while running and a message when failed', async () => {
    const id = newReportId();
    await createReport(t.db, { _id: id, projectName: 'p', hasLockfile: false, deps: [], skipped: [] }, new Date());
    const running = await t.app.inject({ url: `/r/${id}` });
    expect(running.body).toContain(`data-status-url="/r/${id}/status"`);
    expect(running.body).toContain('http-equiv="refresh"');
    await setReportFailed(t.db, id, 'timeout');
    expect((await t.app.inject({ url: `/r/${id}` })).body).toContain('took too long');
  });

  it('treats a report still running after 3 minutes as failed', async () => {
    const id = newReportId();
    await createReport(t.db, { _id: id, projectName: 'p', hasLockfile: false, deps: [], skipped: [] }, new Date(Date.now() - 4 * 60_000));
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.body).toContain('Something went wrong while checking');
    expect(res.body).not.toContain('http-equiv="refresh"');
    expect((await t.app.inject({ url: `/r/${id}/status` })).json()).toEqual({ status: 'failed' });
  });

  it('exports Markdown and JSON', async () => {
    const id = await doneReport(deps);
    const md = await t.app.inject({ url: `/r/${id}.md` });
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body).toContain('| lodash | 4.17.15 | 4.17.21 | High |');
    const json = await t.app.inject({ url: `/r/${id}.json` });
    expect(json.json()).toMatchObject({ id, projectName: 'acme-shop-api', score: expect.any(Number) });
  });

  it('404s unknown and malformed ids', async () => {
    expect((await t.app.inject({ url: '/r/AAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/r/%3Cscript%3E' })).statusCode).toBe(404);
  });
});
