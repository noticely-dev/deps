import type { Advisory, RangeEvent } from '../analyze/types.js';
import { getJson, UpstreamError, type CallOptions, type FetchFn } from './http.js';

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MODERATE', 'LOW']);
export const OSV_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

type BatchResult = { vulns?: Array<{ id?: unknown }>; next_page_token?: unknown };
const MAX_PAGES = 20;

export async function queryOsv(fetchFn: FetchFn, items: Array<{ name: string; version: string }>, o: CallOptions = {}) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < items.length; i += 1000) {
    const chunk = items.slice(i, i + 1000);
    // OSV pages per query: a result with next_page_token has more vulnerabilities, fetched by repeating
    // just those queries with page_token until no token is left.
    let pending = chunk.map((it) => ({ it, token: undefined as string | undefined }));
    for (let page = 0; pending.length > 0; page++) {
      if (page === MAX_PAGES) throw new UpstreamError('osv', 200, 'osv: querybatch kept paging');
      const body = await getJson<{ results?: BatchResult[] }>(fetchFn, 'https://api.osv.dev/v1/querybatch', {
        ...o, source: 'osv',
        body: { queries: pending.map(({ it, token }) => ({ package: { name: it.name, ecosystem: 'npm' }, version: it.version, ...(token ? { page_token: token } : {}) })) },
      });
      // One result per query, in order. Anything else must not be read as "no vulnerabilities" (or cached).
      const results = body?.results;
      if (!Array.isArray(results) || results.length !== pending.length) {
        throw new UpstreamError('osv', 200, 'osv: querybatch returned an unexpected number of results');
      }
      const next: typeof pending = [];
      pending.forEach(({ it }, idx) => {
        const key = `${it.name}@${it.version}`;
        const ids = (results[idx]?.vulns ?? []).map((v) => v.id).filter((id): id is string => typeof id === 'string' && OSV_ID_RE.test(id));
        out.set(key, [...new Set([...(out.get(key) ?? []), ...ids])]);
        const token = results[idx]?.next_page_token;
        if (typeof token === 'string' && token) next.push({ it, token });
      });
      pending = next;
    }
  }
  return out;
}

export function extractAdvisory(doc: unknown): Advisory {
  const d = rec(doc);
  const id = String(d.id ?? '');
  const sev = rec(d.database_specific).severity;
  const summary = typeof d.summary === 'string' && d.summary.trim() ? d.summary.trim()
    : typeof d.details === 'string' ? d.details.trim().slice(0, 200) : id;
  // Null prototype: package names come from OSV and could in theory be "__proto__".
  const npmRanges = Object.create(null) as Record<string, RangeEvent[][]>;
  for (const a of Array.isArray(d.affected) ? d.affected : []) {
    const pkg = rec(rec(a).package);
    if (pkg.ecosystem !== 'npm' || typeof pkg.name !== 'string') continue;
    for (const r of Array.isArray(rec(a).ranges) ? rec(a).ranges as unknown[] : []) {
      if (rec(r).type !== 'SEMVER') continue;
      const events: RangeEvent[] = [];
      for (const e of Array.isArray(rec(r).events) ? rec(r).events as unknown[] : []) {
        const ev = rec(e);
        const item: RangeEvent = {};
        for (const k of ['introduced', 'fixed', 'last_affected'] as const) if (typeof ev[k] === 'string') item[k] = ev[k] as string;
        if (Object.keys(item).length) events.push(item);
      }
      (npmRanges[pkg.name] ??= []).push(events);
    }
  }
  // MAL-* advisories (OpenSSF malicious packages) usually carry no severity: installing one is a compromise.
  const severity = typeof sev === 'string' && SEVERITIES.has(sev) ? sev as Advisory['severity'] : id.startsWith('MAL-') ? 'CRITICAL' : null;
  return {
    id, summary: summary.slice(0, 300),
    severity,
    npmRanges,
  };
}

export async function fetchAdvisory(fetchFn: FetchFn, id: string, o: CallOptions = {}): Promise<Advisory | null> {
  if (!OSV_ID_RE.test(id)) return null;
  const doc = await getJson<unknown>(fetchFn, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { ...o, source: 'osv', allow404: true });
  return doc === null ? null : extractAdvisory(doc);
}
