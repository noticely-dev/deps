import type { DepsDevInfo } from '../analyze/types.js';
import { getJson, type CallOptions, type FetchFn } from './http.js';

const EMPTY: DepsDevInfo = { repo: null, scorecard: null, stars: null };
type VersionDoc = { relatedProjects?: Array<{ projectKey?: { id?: string }; relationType?: string }> };
type ProjectDoc = { scorecard?: { overallScore?: number }; starsCount?: number };

export async function fetchDepsDev(fetchFn: FetchFn, name: string, version: string, o: CallOptions = {}): Promise<DepsDevInfo> {
  const v = await getJson<VersionDoc>(fetchFn,
    `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`,
    { ...o, source: 'deps.dev', allow404: true });
  const repo = v?.relatedProjects?.find((p) => p.relationType === 'SOURCE_REPO')?.projectKey?.id;
  if (!repo) return { ...EMPTY };
  const p = await getJson<ProjectDoc>(fetchFn, `https://api.deps.dev/v3/projects/${encodeURIComponent(repo)}`,
    { ...o, source: 'deps.dev', allow404: true });
  return {
    repo,
    scorecard: typeof p?.scorecard?.overallScore === 'number' ? p.scorecard.overallScore : null,
    stars: typeof p?.starsCount === 'number' ? p.starsCount : null,
  };
}
