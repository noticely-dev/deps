import { describe, expect, it } from 'vitest';
import { InputError, LIMITS, parseInput } from '../../src/analyze/parse.js';

const pkg = (o: unknown) => JSON.stringify(o);

describe('parseInput', () => {
  it('reads prod and dev dependencies, prod wins on duplicates', () => {
    const r = parseInput(pkg({
      name: 'acme-shop-api',
      dependencies: { express: '^5.1.0', lodash: '4.17.15' },
      devDependencies: { lodash: '^4.17.21', vitest: '^5.0.0' },
    }), null);
    expect(r.projectName).toBe('acme-shop-api');
    expect(r.hasLockfile).toBe(false);
    expect(r.deps).toEqual([
      { name: 'express', spec: '^5.1.0', scope: 'prod', lockVersion: null },
      { name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null },
      { name: 'vitest', spec: '^5.0.0', scope: 'dev', lockVersion: null },
    ]);
  });

  it('strips a UTF-8 BOM and CRLF line endings', () => {
    const r = parseInput('﻿{\r\n"dependencies":{"express":"5.1.0"}\r\n}', null);
    expect(r.deps[0]?.name).toBe('express');
    expect(r.projectName).toBe('unnamed project');
  });

  it('accepts a package.json without dependencies', () => {
    expect(parseInput(pkg({ name: 'x' }), null).deps).toEqual([]);
  });

  it('skips non-registry specs with a reason', () => {
    const r = parseInput(pkg({ dependencies: {
      a: 'git+https://github.com/a/a.git', b: 'github:b/b', c: 'file:../c', d: 'workspace:*',
      e: 'https://x.test/e.tgz', f: 'npm:other@1', g: 'user/repo', h: 'link:../h',
    } }), null);
    expect(r.deps).toEqual([]);
    expect(r.skipped.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(r.skipped[0]?.reason).toBe('Not from the npm registry');
  });

  it('skips invalid names and specs instead of failing', () => {
    const r = parseInput(pkg({ dependencies: {
      '<script>alert(1)</script>': '1.0.0', ok: 'x'.repeat(LIMITS.maxSpecLength + 1), fine: 1,
    } }), null);
    expect(r.deps).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['Invalid package name', 'Invalid version spec', 'Invalid version spec']);
  });

  it.each([
    ['not json', 'This is not valid JSON'],
    ['[1,2]', 'package.json must be a JSON object'],
    ['{"__proto__":{"x":1}}', 'This is not valid JSON'],
    ['{"constructor":{"prototype":{"x":1}}}', 'This is not valid JSON'],
  ])('rejects %s', (text, message) => {
    expect(() => parseInput(text, null)).toThrowError(new InputError(message));
  });

  it('rejects deeply nested JSON', () => {
    const deep = '{"a":'.repeat(LIMITS.maxDepth + 1) + '1' + '}'.repeat(LIMITS.maxDepth + 1);
    expect(() => parseInput(deep, null)).toThrow(InputError);
  });

  it('rejects oversized files and too many dependencies', () => {
    expect(() => parseInput(' '.repeat(LIMITS.packageJsonBytes + 1), null)).toThrow(/too large/);
    const many = Object.fromEntries(Array.from({ length: LIMITS.maxDeps + 1 }, (_, i) => [`p${i}`, '1.0.0']));
    expect(() => parseInput(pkg({ dependencies: many }), null)).toThrow(/at most 300/);
  });

  it('takes exact versions from a v3 lockfile, top-level packages only', () => {
    const lock = pkg({
      lockfileVersion: 3,
      packages: {
        '': { name: 'x' },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/@fastify/static': { version: '10.1.5' },
        'node_modules/express/node_modules/debug': { version: '2.6.9' },
      },
    });
    const r = parseInput(pkg({ dependencies: { lodash: '^4.17.15', '@fastify/static': '^10.0.0', debug: '^4.0.0' } }), lock);
    expect(r.hasLockfile).toBe(true);
    expect(r.deps.map((d) => [d.name, d.lockVersion])).toEqual([
      ['lodash', '4.17.21'], ['@fastify/static', '10.1.5'], ['debug', null],
    ]);
  });

  it('takes exact versions from a v1 lockfile, top-level entries only', () => {
    const lock = pkg({
      lockfileVersion: 1,
      dependencies: {
        lodash: { version: '4.17.21' },
        express: { version: '4.18.2', dependencies: { debug: { version: '2.6.9' } } },
        mine: { version: 'github:me/mine#abc' },
      },
    });
    const r = parseInput(pkg({ dependencies: { lodash: '^4.17.15', express: '^4.0.0', debug: '^4.0.0', mine: '^1.0.0' } }), lock);
    expect(r.hasLockfile).toBe(true);
    expect(r.lockfileIgnored).toBeUndefined();
    expect(r.deps.map((d) => [d.name, d.lockVersion])).toEqual([
      ['lodash', '4.17.21'], ['express', '4.18.2'], ['debug', null], ['mine', null],
    ]);
  });

  it('ignores an unusable lockfile and says why, instead of rejecting the check', () => {
    const notJson = parseInput(pkg({ dependencies: { lodash: '^4.17.15' } }), 'lodash@^4.17.15:\n  version "4.17.21"');
    expect(notJson).toMatchObject({ hasLockfile: false, lockfileIgnored: 'not valid JSON' });
    expect(notJson.deps[0]?.lockVersion).toBeNull();
    for (const lock of [pkg({ lockfileVersion: 4, packages: {} }), pkg({ lockfileVersion: 1 }), pkg({ name: 'x' })]) {
      expect(parseInput('{}', lock)).toMatchObject({ hasLockfile: false, lockfileIgnored: 'unsupported format' });
    }
    expect(() => parseInput('{}', ' '.repeat(LIMITS.lockfileBytes + 1))).toThrow(/lockfile is too large/);
  });
});
