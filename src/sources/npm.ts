import type { NpmInfo } from '../analyze/types.js';
import { getJson, type CallOptions, type FetchFn } from './http.js';

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function registryPath(name: string): string {
  return name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
}

export const NOT_FOUND: NpmInfo = {
  found: false, latest: null, distTags: {}, versions: [], lastPublish: null, maintainers: 0, deprecatedLatest: null, deprecated: {},
};

export function extractNpm(doc: unknown): NpmInfo {
  const d = rec(doc);
  const distTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(d['dist-tags']))) if (typeof v === 'string') distTags[k] = v;
  const versionsObj = rec(d.versions);
  const versions = Object.keys(versionsObj);
  const deprecated: Record<string, string> = {};
  for (const v of versions) {
    const msg = rec(versionsObj[v]).deprecated;
    if (typeof msg === 'string' && msg.trim()) deprecated[v] = msg.trim().slice(0, 500);
  }
  const time = rec(d.time);
  let lastPublish: string | null = null;
  for (const v of versions) {
    const t = time[v];
    if (typeof t === 'string' && (lastPublish === null || Date.parse(t) > Date.parse(lastPublish))) lastPublish = t;
  }
  const latest = distTags.latest ?? null;
  return {
    found: true, latest, distTags, versions, lastPublish,
    maintainers: Array.isArray(d.maintainers) ? d.maintainers.length : 0,
    deprecatedLatest: latest && Object.hasOwn(deprecated, latest) ? deprecated[latest] ?? null : null,
    deprecated,
  };
}

export async function fetchNpm(fetchFn: FetchFn, name: string, o: CallOptions = {}): Promise<NpmInfo> {
  const doc = await getJson<unknown>(fetchFn, `https://registry.npmjs.org/${registryPath(name)}`, { ...o, source: 'npm', allow404: true });
  return doc === null ? NOT_FOUND : extractNpm(doc);
}
