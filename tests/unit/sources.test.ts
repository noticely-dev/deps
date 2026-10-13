import { describe, expect, it } from 'vitest';
import { getJson, UpstreamError } from '../../src/sources/http.js';
import { mapLimit } from '../../src/sources/limit.js';
import { extractNpm, registryPath } from '../../src/sources/npm.js';
import { fetchDownloads } from '../../src/sources/downloads.js';
import { extractAdvisory, queryOsv } from '../../src/sources/osv.js';
import { fetchDepsDev } from '../../src/sources/depsdev.js';
import { createSources } from '../../src/sources/index.js';
import { analyzeDeps } from '../../src/check/analyze-deps.js';
import { memoryCache } from '../../src/store/cache.js';
import { fakeFetch } from '../helpers/fakes.js';

const fast = { source: 'test', backoffMs: 1 };

describe('getJson', () => {
  it('retries 5xx and 429, then succeeds', () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => (++n < 3 ? { status: n === 1 ? 500 : 429 } : { body: { ok: true } }));
    return getJson(fetch, 'https://x.test/a', fast).then((r) => {
      expect(r).toEqual({ ok: true });
      expect(calls).toHaveLength(3);
    });
  });

  it('returns null for an allowed 404 and throws on other errors', async () => {
    const { fetch } = fakeFetch((u) => ({ status: u.endsWith('404') ? 404 : 400 }));
    expect(await getJson(fetch, 'https://x.test/404', { ...fast, allow404: true })).toBeNull();
    await expect(getJson(fetch, 'https://x.test/400', fast)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('times out slow responses and enforces the size cap', async () => {
    const slow = fakeFetch(() => ({ body: {}, delayMs: 200 }));
    await expect(getJson(slow.fetch, 'https://x.test/slow', { ...fast, timeoutMs: 20, retries: 1 })).rejects.toBeInstanceOf(UpstreamError);
    expect(slow.calls).toHaveLength(2);
    const big = fakeFetch(() => ({ body: { s: 'x'.repeat(2000) } }));
    await expect(getJson(big.fetch, 'https://x.test/big', { ...fast, maxBytes: 1000 })).rejects.toThrow(/too large/);
  });

  it('wraps invalid JSON in UpstreamError', async () => {
    const badJson = (async () => new Response('{not json', { status: 200 })) as typeof fetch;
    await expect(getJson(badJson, 'https://x.test/bad', fast)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('retries a body that errors mid-read, then succeeds', async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n === 1) return new Response(new ReadableStream({ pull(c) { c.error(new Error('connection reset')); } }), { status: 200 });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    expect(await getJson(flaky, 'https://x.test/flaky', fast)).toEqual({ ok: true });
    expect(n).toBe(2);
  });
});

describe('fetchDownloads concurrency', () => {
  it('never has more scoped requests in flight than the configured limit', async () => {
    let active = 0, peak = 0;
    const f = (async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(JSON.stringify({ downloads: 1 }), { status: 200 });
    }) as typeof fetch;
    const names = Array.from({ length: 20 }, (_, i) => `@scope/pkg${i}`);
    const r = await fetchDownloads(f, names, { backoffMs: 1, concurrency: 3 });
    expect(r.failed.size).toBe(0);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('mapLimit', () => {
  it('keeps order and never exceeds the limit', async () => {
    let active = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe('npm', () => {
  it('encodes scoped names', () => {
    expect(registryPath('@fastify/static')).toBe('@fastify%2Fstatic');
    expect(registryPath('lodash')).toBe('lodash');
  });

  it('extracts the fields the rules need', () => {
    const info = extractNpm({
      'dist-tags': { latest: '2.88.2' },
      versions: {
        '2.88.0': { deprecated: 'request has been deprecated, see https://github.com/request/request/issues/3142' },
        '2.88.2': { deprecated: 'request has been deprecated, see https://github.com/request/request/issues/3142' },
        '2.87.0': {},
      },
      time: { created: '2011-01-22T00:00:00Z', modified: '2026-07-17T00:00:00Z', '2.87.0': '2018-05-21T00:00:00Z',
        '2.88.0': '2018-07-17T00:00:00Z', '2.88.2': '2020-02-11T16:47:01Z' },
      maintainers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
    });
    expect(info).toEqual({
      found: true, latest: '2.88.2', distTags: { latest: '2.88.2' }, versions: ['2.88.0', '2.88.2', '2.87.0'],
      lastPublish: '2020-02-11T16:47:01Z', maintainers: 4,
      deprecatedLatest: 'request has been deprecated, see https://github.com/request/request/issues/3142',
      deprecated: {
        '2.88.0': 'request has been deprecated, see https://github.com/request/request/issues/3142',
        '2.88.2': 'request has been deprecated, see https://github.com/request/request/issues/3142',
      },
    });
  });
});

describe('downloads', () => {
  it('handles bulk, single and scoped responses', async () => {
    const { fetch, calls } = fakeFetch((u) => {
      if (u.endsWith('/express,lodash')) return { body: { express: { downloads: 10, package: 'express' }, lodash: null } };
      if (u.endsWith('/%40fastify%2Fstatic')) return { body: { downloads: 5, package: '@fastify/static' } };
      return { status: 500 };
    });
    const r = await fetchDownloads(fetch, ['express', 'lodash', '@fastify/static'], { backoffMs: 1 });
    expect([...r.values]).toEqual([['express', 10], ['lodash', null], ['@fastify/static', 5]]);
    expect(r.failed.size).toBe(0);
    expect(calls.map((c) => c.url)).toContain('https://api.npmjs.org/downloads/point/last-week/express,lodash');
  });

  it('skips the remaining requests after the first failure', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 500 }));
    const names = Array.from({ length: 20 }, (_, i) => `@s/p${i}`);
    const r = await fetchDownloads(fetch, names, { backoffMs: 1, concurrency: 8 });
    expect(r.failed.size).toBe(20);
    expect([...r.values.values()].every((v) => v === null)).toBe(true);
    expect(calls).toHaveLength(24);
  });
});

describe('osv', () => {
  it('maps batch results by name@version', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { results: [{ vulns: [{ id: 'GHSA-35jh-r3h4-6jhm', modified: 'x' }] }, {}] } }));
    const r = await queryOsv(fetch, [{ name: 'lodash', version: '4.17.15' }, { name: 'express', version: '5.1.0' }], { backoffMs: 1 });
    expect([...r]).toEqual([['lodash@4.17.15', ['GHSA-35jh-r3h4-6jhm']], ['express@5.1.0', []]]);
    expect(JSON.parse(calls[0]?.body ?? '{}').queries[0]).toEqual({ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' });
  });

  it('treats a missing or short batch result as an upstream error, never as clean', async () => {
    const items = [{ name: 'lodash', version: '4.17.15' }, { name: 'express', version: '5.1.0' }];
    for (const body of [{}, { results: [{}] }, { results: [{}, {}, {}] }]) {
      const { fetch } = fakeFetch(() => ({ body }));
      await expect(queryOsv(fetch, items, { backoffMs: 1 })).rejects.toBeInstanceOf(UpstreamError);
    }
  });

  it('rates malicious-package advisories without a severity as critical', () => {
    expect(extractAdvisory({ id: 'MAL-2025-1234', summary: 'Malicious code in evil-pkg' }).severity).toBe('CRITICAL');
    expect(extractAdvisory({ id: 'MAL-2025-1234', database_specific: { severity: 'LOW' } }).severity).toBe('LOW');
    expect(extractAdvisory({ id: 'GHSA-xxxx-yyyy-zzzz' }).severity).toBeNull();
  });

  it('extracts npm SEMVER ranges and severity', () => {
    expect(extractAdvisory({
      id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash',
      database_specific: { severity: 'HIGH' },
      affected: [
        { package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] },
        { package: { name: 'lodash-rails', ecosystem: 'RubyGems' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }] }] },
      ],
    })).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
      npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] },
    });
  });
});

describe('deps.dev', () => {
  it('follows the source repo to its scorecard', async () => {
    const { fetch } = fakeFetch((u) => {
      if (u.includes('/packages/express/versions/')) return { body: { relatedProjects: [
        { projectKey: { id: 'github.com/expressjs/express' }, relationType: 'ISSUE_TRACKER' },
        { projectKey: { id: 'github.com/expressjs/express' }, relationType: 'SOURCE_REPO' }] } };
      if (u.endsWith('/projects/github.com%2Fexpressjs%2Fexpress')) return { body: { scorecard: { overallScore: 8.5 }, starsCount: 69553 } };
      return { status: 404 };
    });
    expect(await fetchDepsDev(fetch, 'express', '5.1.0', { backoffMs: 1 })).toEqual({ repo: 'github.com/expressjs/express', scorecard: 8.5, stars: 69553 });
    expect(await fetchDepsDev(fetch, 'unknown', '1.0.0', { backoffMs: 1 })).toEqual({ repo: null, scorecard: null, stars: null });
  });
});

describe('createSources', () => {
  const npmDoc = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, time: { '1.0.0': '2026-01-01T00:00:00Z' }, maintainers: [{}] };

  it('caches npm lookups', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: npmDoc }));
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    await s.npmInfos(['a', 'b']);
    await s.npmInfos(['a', 'b']);
    expect(calls).toHaveLength(2);
  });

  it('reports unavailable sources instead of failing', async () => {
    const { fetch } = fakeFetch((u) => {
      if (u.startsWith('https://api.npmjs.org/')) return { status: 503 };
      if (u.startsWith('https://api.osv.dev/v1/querybatch')) return { body: { results: [{}] } };
      return { status: 404 };
    });
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    const d = await s.details([{ name: 'a', version: '1.0.0' }]);
    expect([...d.unavailable]).toEqual(['downloads']);
    expect(d.downloads.get('a')).toBeNull();
    expect(d.vulns.get('a@1.0.0')).toEqual([]);
    expect(d.depsdev.get('a@1.0.0')).toEqual({ repo: null, scorecard: null, stars: null });

    const down = fakeFetch(() => ({ status: 500 }));
    const s2 = createSources({ fetch: down.fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    const r = await s2.npmInfos(['a']);
    expect(r.unavailable).toBe(true);
    expect(r.infos.has('a')).toBe(false);
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, version: '1.0.0' }));

  it('stops calling a source after its first failure in a check (circuit breaker)', async () => {
    const { fetch, calls } = fakeFetch((u) => {
      if (u.startsWith('https://api.deps.dev/')) return { body: {}, delayMs: 10_000 };
      if (u.startsWith('https://api.osv.dev/v1/querybatch')) return { body: { results: many(40).map(() => ({})) } };
      if (u.startsWith('https://registry.npmjs.org/')) return { status: 500 };
      return { body: {} };
    });
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1, timeoutMs: 20 });
    const d = await s.details(many(40));
    expect([...d.unavailable]).toEqual(['deps.dev']);
    expect(d.depsdev.get('p39@1.0.0')).toBeNull();
    // 8 requests in flight when the source fails, each tried 3 times; the other 32 items are skipped.
    expect(calls.filter((c) => c.url.startsWith('https://api.deps.dev/'))).toHaveLength(24);

    const r = await s.npmInfos(many(20).map((i) => i.name));
    expect(r.unavailable).toBe(true);
    expect(calls.filter((c) => c.url.startsWith('https://registry.npmjs.org/'))).toHaveLength(24);
  });

  it('gives non-essential sources their own deadline, so a hanging source leaves a partial report', async () => {
    const npmDoc1 = { ...npmDoc, maintainers: [{}, {}] };
    const { fetch } = fakeFetch((u) => {
      if (u.startsWith('https://registry.npmjs.org/')) return { body: npmDoc1 };
      if (u.startsWith('https://api.osv.dev/v1/querybatch')) return { body: { results: many(40).map(() => ({})) } };
      if (u.startsWith('https://api.deps.dev/')) return { body: {}, delayMs: 10_000 };
      return { body: {} };
    });
    // Per-request timeout far above the deadline: only the deadline can end the hanging deps.dev calls.
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1, timeoutMs: 5_000, nonEssentialMs: 100 });
    const started = Date.now();
    const deps = many(40).map((i) => ({ name: i.name, spec: '1.0.0', scope: 'prod' as const, lockVersion: null }));
    const result = await analyzeDeps({ deps }, s, {}, new Date('2026-06-01T00:00:00Z'), AbortSignal.timeout(2_000));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.partial).toEqual(['deps.dev']);
    expect(result.packages.every((p) => p.status === 'checked' && p.scorecard === null)).toBe(true);
  });

  it('still propagates the check timeout', async () => {
    const { fetch } = fakeFetch(() => ({ body: {}, delayMs: 10_000 }));
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1, timeoutMs: 5_000, nonEssentialMs: 5_000 });
    await expect(s.details(many(3), AbortSignal.timeout(50))).rejects.toThrow();
  });
});
