import type { PackageResult } from '../../src/analyze/types.js';

export const pr = (o: Partial<PackageResult> = {}): PackageResult => ({
  name: 'p', scope: 'prod', spec: '1.0.0', resolved: '1.0.0', resolution: 'lockfile', status: 'checked',
  latest: '1.0.0', lastPublish: null, maintainers: 2, downloads: 10, scorecard: null, stars: null,
  deprecated: null, vulns: [], findings: [], risk: 'healthy', majorsBehind: 0, worstCase: false, ...o,
});
