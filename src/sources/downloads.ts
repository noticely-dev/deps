import { getJson, type CallOptions, type FetchFn } from './http.js';
import { mapLimit } from './limit.js';

const BASE = 'https://api.npmjs.org/downloads/point/last-week/';
type Point = { downloads?: number } | null;

export async function fetchDownloads(fetchFn: FetchFn, names: string[], o: CallOptions & { concurrency?: number } = {}) {
  const { concurrency = 8, ...call } = o;
  const values = new Map<string, number | null>();
  const failed = new Set<string>();
  // Circuit breaker: after the first failed request (or an abort), the remaining requests are skipped.
  // Failures never throw; the caller checks its own abort signal.
  let down = false;
  const fail = (names: string[]) => { down = true; for (const n of names) { values.set(n, null); failed.add(n); } };
  const unscoped = names.filter((n) => !n.startsWith('@'));
  const scoped = names.filter((n) => n.startsWith('@'));
  const chunks: string[][] = [];
  for (let i = 0; i < unscoped.length; i += 128) chunks.push(unscoped.slice(i, i + 128));

  const jobs: Array<() => Promise<void>> = [
    ...chunks.map((chunk) => async () => {
      if (down) return fail(chunk);
      try {
        const body = await getJson<Record<string, Point> & Point>(fetchFn, BASE + chunk.map(encodeURIComponent).join(','), { ...call, source: 'downloads', allow404: true });
        for (const n of chunk) {
          const point = chunk.length === 1 ? body : (body as Record<string, Point> | null)?.[n];
          values.set(n, typeof point?.downloads === 'number' ? point.downloads : null);
        }
      } catch {
        fail(chunk);
      }
    }),
    ...scoped.map((n) => async () => {
      if (down) return fail([n]);
      try {
        // Scoped names go one per request and fully encoded: @fastify/static -> %40fastify%2Fstatic
        const body = await getJson<Point>(fetchFn, BASE + encodeURIComponent(n), { ...call, source: 'downloads', allow404: true });
        values.set(n, typeof body?.downloads === 'number' ? body.downloads : null);
      } catch {
        fail([n]);
      }
    }),
  ];
  await mapLimit(jobs, concurrency, (job) => job());
  return { values: new Map(names.map((n) => [n, values.get(n) ?? null])), failed };
}
