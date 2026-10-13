import semver from 'semver';
import type { NpmInfo, ResolvedDep, StoredDep } from './types.js';

const LATEST_ALIASES = new Set(['', '*', 'x', 'latest']);

export function resolveDep(dep: StoredDep, npm: NpmInfo | undefined, npmUnavailable: boolean): ResolvedDep {
  if (!npm) return { ...dep, resolved: null, resolution: npmUnavailable ? 'unavailable' : 'not-found' };
  if (!npm.found) return { ...dep, resolved: null, resolution: 'not-found' };

  if (dep.lockVersion && semver.valid(dep.lockVersion)) {
    return { ...dep, resolved: dep.lockVersion, resolution: 'lockfile' };
  }
  const spec = dep.spec.trim();
  if (LATEST_ALIASES.has(spec)) {
    return npm.latest
      ? { ...dep, resolved: npm.latest, resolution: 'tag' }
      : { ...dep, resolved: null, resolution: 'no-match' };
  }
  const tagged = Object.hasOwn(npm.distTags, spec) ? npm.distTags[spec] : undefined;
  if (tagged) return { ...dep, resolved: tagged, resolution: 'tag' };

  if (semver.validRange(spec)) {
    const min = semver.minSatisfying(npm.versions, spec);
    return min ? { ...dep, resolved: min, resolution: 'range-min' } : { ...dep, resolved: null, resolution: 'no-match' };
  }
  return { ...dep, resolved: null, resolution: 'invalid-spec' };
}
