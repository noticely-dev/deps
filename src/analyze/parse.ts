import sjson from 'secure-json-parse';
import semver from 'semver';
import type { ParsedInput, Scope, SkippedDep, StoredDep } from './types.js';

export const LIMITS = {
  packageJsonBytes: 256 * 1024,
  lockfileBytes: 10 * 1024 * 1024,
  maxDeps: 300,
  maxNameLength: 214,
  maxSpecLength: 256,
  maxDepth: 64,
} as const;

export class InputError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = 'InputError';
  }
}

const NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const NON_REGISTRY_RE = /^(?:git\+|git:|github:|gitlab:|bitbucket:|file:|link:|workspace:|portal:|patch:|https?:|npm:)/i;
const SHORTHAND_RE = /^[^@\s/][^\s/]*\/[^\s/]+$/;

export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= LIMITS.maxNameLength && NAME_RE.test(name);
}

function depth(value: unknown, level = 0): number {
  if (level > LIMITS.maxDepth) return level;
  if (value === null || typeof value !== 'object') return level;
  let max = level;
  for (const v of Object.values(value as Record<string, unknown>)) {
    max = Math.max(max, depth(v, level + 1));
    if (max > LIMITS.maxDepth) break;
  }
  return max;
}

function parseJson(text: string, what: string): unknown {
  let value: unknown;
  try {
    value = sjson.parse(text.replace(/^\uFEFF/, ''), undefined, { protoAction: 'error', constructorAction: 'error' });
  } catch {
    throw new InputError(what === 'package.json' ? 'This is not valid JSON' : 'The lockfile is not valid JSON');
  }
  if (depth(value) > LIMITS.maxDepth) throw new InputError(`The ${what} is nested too deeply`);
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lockVersions(text: string): Map<string, string> {
  if (Buffer.byteLength(text, 'utf8') > LIMITS.lockfileBytes) throw new InputError('The lockfile is too large (max 10 MB)');
  const lock = parseJson(text, 'lockfile');
  if (!isRecord(lock) || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !isRecord(lock.packages)) {
    throw new InputError('Only npm lockfile v2 or v3 (npm 7 or newer) is supported');
  }
  const out = new Map<string, string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice('node_modules/'.length);
    if (name.includes('node_modules/')) continue; // nested, not a direct install location
    if (isRecord(entry) && typeof entry.version === 'string' && semver.valid(entry.version)) out.set(name, entry.version);
  }
  return out;
}

export function parseInput(packageJsonText: string, lockfileText: string | null): ParsedInput {
  if (Buffer.byteLength(packageJsonText, 'utf8') > LIMITS.packageJsonBytes) {
    throw new InputError('package.json is too large (max 256 KB)');
  }
  const pkg = parseJson(packageJsonText, 'package.json');
  if (!isRecord(pkg)) throw new InputError('package.json must be a JSON object');

  const locks = lockfileText ? lockVersions(lockfileText) : null;
  const projectName = typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim().slice(0, 100) : 'unnamed project';

  const deps: StoredDep[] = [];
  const skipped: SkippedDep[] = [];
  const seen = new Set<string>();
  const sections: Array<[unknown, Scope]> = [[pkg.dependencies, 'prod'], [pkg.devDependencies, 'dev']];

  for (const [section, scope] of sections) {
    if (!isRecord(section)) continue;
    for (const [name, rawSpec] of Object.entries(section)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const spec = typeof rawSpec === 'string' ? rawSpec.trim() : '';
      const shownName = name.slice(0, LIMITS.maxNameLength);
      const shownSpec = typeof rawSpec === 'string' ? rawSpec.slice(0, LIMITS.maxSpecLength) : '';
      if (!isValidPackageName(name)) {
        skipped.push({ name: shownName, spec: shownSpec, scope, reason: 'Invalid package name' });
      } else if (typeof rawSpec !== 'string' || rawSpec.length > LIMITS.maxSpecLength) {
        skipped.push({ name, spec: shownSpec, scope, reason: 'Invalid version spec' });
      } else if (NON_REGISTRY_RE.test(spec) || (SHORTHAND_RE.test(spec) && !semver.validRange(spec))) {
        skipped.push({ name, spec, scope, reason: 'Not from the npm registry' });
      } else {
        deps.push({ name, spec, scope, lockVersion: locks?.get(name) ?? null });
      }
    }
  }

  if (deps.length + skipped.length > LIMITS.maxDeps) {
    throw new InputError(`This tool checks at most 300 direct dependencies (found ${deps.length + skipped.length})`);
  }
  return { projectName, hasLockfile: locks !== null, deps, skipped };
}
