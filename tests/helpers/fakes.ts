import type { Advisory, DepsDevInfo, NpmInfo, SourceName } from '../../src/analyze/types.js';
import type { Sources } from '../../src/sources/index.js';

export interface FakeRoute { status?: number; body?: unknown; delayMs?: number }

export function fakeFetch(handler: (url: string, init?: RequestInit) => FakeRoute) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    const route = handler(url, init);
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal?.reason); });
      });
    }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export interface FakeSourceData {
  npm: Record<string, NpmInfo>;
  vulns: Record<string, string[]>;
  advisories: Record<string, Advisory>;
  unavailable: SourceName[];
  npmUnavailable: boolean;
  delayMs: number;
}

export const npmInfo = (o: Partial<NpmInfo> = {}): NpmInfo => ({
  found: true, latest: '1.0.0', distTags: { latest: '1.0.0' }, versions: ['1.0.0'], lastPublish: '2026-06-01T00:00:00Z',
  maintainers: 3, deprecatedLatest: null, deprecated: {}, ...o,
});

export function fakeSources(o: Partial<FakeSourceData> = {}): Sources {
  const d: FakeSourceData = { npm: {}, vulns: {}, advisories: {}, unavailable: [], npmUnavailable: false, delayMs: 0, ...o };
  const wait = async (signal?: AbortSignal) => {
    if (!d.delayMs) return;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, d.delayMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); });
    });
  };
  return {
    async npmInfos(names, signal) {
      await wait(signal);
      const infos = new Map<string, NpmInfo>();
      for (const n of names) if (d.npm[n]) infos.set(n, d.npm[n]);
      return { infos, unavailable: d.npmUnavailable };
    },
    async details(items) {
      const dd: DepsDevInfo = { repo: null, scorecard: 7, stars: 100 };
      const unavailable = new Set(d.unavailable);
      return {
        downloads: new Map(items.map((i) => [i.name, unavailable.has('downloads') ? null : 1000])),
        vulns: new Map(items.map((i) => [`${i.name}@${i.version}`, unavailable.has('osv') ? null : d.vulns[`${i.name}@${i.version}`] ?? []])),
        depsdev: new Map(items.map((i) => [`${i.name}@${i.version}`, unavailable.has('deps.dev') ? null : dd])),
        advisories: new Map(Object.entries(d.advisories)),
        unavailable,
      };
    },
  };
}
