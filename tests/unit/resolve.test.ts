import { describe, expect, it } from 'vitest';
import { resolveDep } from '../../src/analyze/resolve.js';
import type { NpmInfo, StoredDep } from '../../src/analyze/types.js';

const npm: NpmInfo = {
  found: true, latest: '4.17.21', distTags: { latest: '4.17.21', next: '5.0.0-beta.1' },
  versions: ['4.17.10', '4.17.15', '4.17.20', '4.17.21', '5.0.0-beta.1'],
  lastPublish: '2021-02-20T00:00:00.000Z', maintainers: 3, deprecatedLatest: null, deprecated: {},
};
const dep = (spec: string, lockVersion: string | null = null): StoredDep => ({ name: 'lodash', spec, scope: 'prod', lockVersion });

describe('resolveDep', () => {
  it('uses the lockfile version when present', () => {
    expect(resolveDep(dep('^4.17.10', '4.17.21'), npm, false)).toMatchObject({ resolved: '4.17.21', resolution: 'lockfile' });
  });

  it('falls back to the lowest matching version when the lockfile lacks the dependency', () => {
    expect(resolveDep(dep('^4.17.15', null), npm, false)).toMatchObject({ resolved: '4.17.15', resolution: 'range-min' });
  });

  it.each([['*'], [''], ['latest'], ['x']])('resolves %j to latest', (spec) => {
    expect(resolveDep(dep(spec), npm, false)).toMatchObject({ resolved: '4.17.21', resolution: 'tag' });
  });

  it('resolves a dist-tag', () => {
    expect(resolveDep(dep('next'), npm, false)).toMatchObject({ resolved: '5.0.0-beta.1', resolution: 'tag' });
  });

  it('ignores prereleases for normal ranges', () => {
    expect(resolveDep(dep('>=4.17.21'), npm, false)).toMatchObject({ resolved: '4.17.21', resolution: 'range-min' });
  });

  it('reports ranges no published version satisfies', () => {
    expect(resolveDep(dep('^99.0.0'), npm, false)).toMatchObject({ resolved: null, resolution: 'no-match' });
  });

  it('reports garbage specs', () => {
    expect(resolveDep(dep('hello world'), npm, false)).toMatchObject({ resolved: null, resolution: 'invalid-spec' });
  });

  it('distinguishes not-found from unavailable', () => {
    expect(resolveDep(dep('1.0.0'), { ...npm, found: false }, false).resolution).toBe('not-found');
    expect(resolveDep(dep('1.0.0'), undefined, true).resolution).toBe('unavailable');
  });
});
