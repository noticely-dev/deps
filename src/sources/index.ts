import type { Advisory, DepsDevInfo, NpmInfo, SourceName } from '../analyze/types.js';
import type { CacheStore } from '../store/cache.js';
import { fetchDepsDev } from './depsdev.js';
import { fetchDownloads } from './downloads.js';
import type { CallOptions, FetchFn, RequestObserver } from './http.js';
import { mapLimit } from './limit.js';
import { fetchNpm } from './npm.js';
import { fetchAdvisory, queryOsv } from './osv.js';

export interface SourceMetrics { request: RequestObserver; cache(hit: boolean): void }
export interface DetailItem { name: string; version: string }
export interface Details {
  downloads: Map<string, number | null>;
  vulns: Map<string, string[] | null>;
  depsdev: Map<string, DepsDevInfo | null>;
  advisories: Map<string, Advisory>;
  unavailable: Set<SourceName>;
}
export interface Sources {
  npmInfos(names: string[], signal?: AbortSignal): Promise<{ infos: Map<string, NpmInfo>; unavailable: boolean }>;
  details(items: DetailItem[], signal?: AbortSignal): Promise<Details>;
}

/** Per-check circuit breaker for one source: once it has failed (after retries), its remaining requests are skipped. */
interface Breaker { open: boolean }
const SKIPPED = new Error('source skipped after an earlier failure');

export function createSources(o: {
  fetch: FetchFn; cache: CacheStore; advisoryCache: CacheStore;
  concurrency?: number; timeoutMs?: number; backoffMs?: number; metrics?: SourceMetrics;
  /** Deadline for the non-essential sources (downloads, deps.dev, advisory details), from the start of details(). */
  nonEssentialMs?: number;
}): Sources {
  const conc = o.concurrency ?? 8;
  const call = (signal?: AbortSignal): CallOptions => ({ signal, timeoutMs: o.timeoutMs, backoffMs: o.backoffMs, observe: o.metrics?.request });

  async function cached<T>(store: CacheStore, key: string, load: () => Promise<T>, breaker?: Breaker): Promise<T> {
    const hit = await store.get<T>(key);
    o.metrics?.cache(hit !== null);
    if (hit) return hit.value;
    if (breaker?.open) throw SKIPPED;
    const value = await load();
    await store.set(key, value);
    return value;
  }

  return {
    async npmInfos(names, signal) {
      const infos = new Map<string, NpmInfo>();
      const breaker: Breaker = { open: false };
      await mapLimit(names, conc, async (name) => {
        try {
          infos.set(name, await cached(o.cache, `npm:${name}`, () => fetchNpm(o.fetch, name, call(signal)), breaker));
        } catch (e) {
          if (signal?.aborted) throw e;
          breaker.open = true;
        }
      });
      return { infos, unavailable: breaker.open };
    },

    async details(items, signal) {
      const unavailable = new Set<SourceName>();
      const key = (it: DetailItem) => `${it.name}@${it.version}`;
      // Non-essential sources stop at their own deadline, well inside the check timeout, and are marked unavailable.
      const deadline = AbortSignal.timeout(o.nonEssentialMs ?? 15_000);
      const extra = signal ? AbortSignal.any([signal, deadline]) : deadline;

      const downloadsTask = (async () => {
        const out = new Map<string, number | null>();
        const missing: string[] = [];
        for (const name of new Set(items.map((i) => i.name))) {
          const hit = await o.cache.get<number | null>(`dl:${name}`);
          o.metrics?.cache(hit !== null);
          if (hit) out.set(name, hit.value); else missing.push(name);
        }
        if (missing.length) {
          const r = await fetchDownloads(o.fetch, missing, { ...call(extra), concurrency: conc });
          signal?.throwIfAborted();
          if (r.failed.size) unavailable.add('downloads');
          for (const [name, v] of r.values) {
            out.set(name, v);
            if (!r.failed.has(name)) await o.cache.set(`dl:${name}`, v);
          }
        }
        return out;
      })();

      const vulnsTask = (async () => {
        const out = new Map<string, string[] | null>();
        const missing: DetailItem[] = [];
        for (const it of items) {
          const hit = await o.cache.get<string[]>(`osv:${key(it)}`);
          o.metrics?.cache(hit !== null);
          if (hit) out.set(key(it), hit.value); else missing.push(it);
        }
        if (missing.length) {
          try {
            const r = await queryOsv(o.fetch, missing, call(signal));
            for (const it of missing) {
              const ids = r.get(key(it)) ?? [];
              out.set(key(it), ids);
              await o.cache.set(`osv:${key(it)}`, ids);
            }
          } catch (e) {
            if (signal?.aborted) throw e;
            unavailable.add('osv');
            for (const it of missing) out.set(key(it), null);
          }
        }
        return out;
      })();

      const depsdevTask = (async () => {
        const out = new Map<string, DepsDevInfo | null>();
        const breaker: Breaker = { open: false };
        await mapLimit(items, conc, async (it) => {
          try {
            out.set(key(it), await cached(o.cache, `dd:${key(it)}`, () => fetchDepsDev(o.fetch, it.name, it.version, call(extra)), breaker));
          } catch (e) {
            if (signal?.aborted) throw e;
            breaker.open = true;
            unavailable.add('deps.dev');
            out.set(key(it), null);
          }
        });
        return out;
      })();

      // Advisory details only wait for the OSV batch, not for the other sources.
      const advisoriesTask = vulnsTask.then(async (vulns) => {
        const advisories = new Map<string, Advisory>();
        const breaker: Breaker = { open: false };
        const ids = [...new Set([...vulns.values()].flatMap((v) => v ?? []))];
        await mapLimit(ids, conc, async (id) => {
          try {
            const adv = await cached(o.advisoryCache, `adv:${id}`, () => fetchAdvisory(o.fetch, id, call(extra)), breaker);
            if (adv) advisories.set(id, adv);
          } catch (e) {
            if (signal?.aborted) throw e;
            breaker.open = true;
            unavailable.add('osv');
          }
        });
        return advisories;
      });

      const [downloads, vulns, depsdev, advisories] = await Promise.all([downloadsTask, vulnsTask, depsdevTask, advisoriesTask]);
      return { downloads, vulns, depsdev, advisories, unavailable };
    },
  };
}
