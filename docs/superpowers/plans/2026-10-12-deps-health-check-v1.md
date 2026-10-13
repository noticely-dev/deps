# noticely/deps — Dependency Health Check v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy `https://deps.noticely.dev`, a free tool. A visitor pastes or uploads a `package.json` (plus an optional `package-lock.json`) and gets a professional dependency-risk report, a prioritised upgrade plan, a contact form, and "notify me" lists for the future paid products.

**Architecture:** One Fastify (TypeScript, Node 24) app renders HTML on the server with Eta templates and stores data in MongoDB 8.0. Analysis is a set of pure functions (`src/analyze/`). They are fed by upstream clients (`src/sources/`) for the npm registry, npm downloads, OSV and deps.dev, all behind a MongoDB-backed cache. Checks run in-process through a small bounded queue (`src/check/`). The app ships as an arm64 image on GHCR and runs as two containers on `app-1` behind the existing Caddy and Cloudflare setup.

**Tech Stack:** Node.js 24 LTS · TypeScript 6.0 · Fastify 5 (+ `@fastify/multipart`, `@fastify/formbody`, `@fastify/static`) · Eta 4 · zod 4 · MongoDB driver 7 / server 8.0 · semver · secure-json-parse · prom-client · Vitest 5 · ESLint 10 + typescript-eslint · Docker · GitHub Actions · Resend (HTTP API) · Cloudflare Turnstile.

**Spec:** `docs/superpowers/specs/2026-10-12-deps-health-check-design.md`

## Global Constraints

- Node `>=24.10 <25`; ESM (`"type": "module"`); relative imports end in `.js`.
- Exact dependency versions, all released ≥ 2 weeks before 2026-10-12:
  - runtime: `fastify@5.12.5`, `@fastify/formbody@9.0.0`, `@fastify/multipart@10.1.2`, `@fastify/static@10.1.5`, `eta@4.6.0`, `zod@4.6.5`, `mongodb@7.6.0`, `semver@7.8.5`, `secure-json-parse@4.1.0`, `prom-client@15.1.3`;
  - dev: `typescript@6.0.3`, `tsx@4.23.15`, `vitest@5.0.2`, `eslint@10.11.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.70.1`, `@types/node@24.19.0`, `@types/semver@7.8.0`.
- Limits (spec §4): `package.json` ≤ 256 KB; lockfile ≤ 10 MB (npm lockfile v2/v3 only); ≤ 300 direct dependencies; name ≤ 214 chars; spec ≤ 256 chars; JSON depth ≤ 64.
- Upstream: 5 s timeout, 2 retries with backoff, concurrency 8, cache 24 h (advisories 7 days).
- Checks: max 4 concurrent, queue 20, 30 s timeout per check.
- Rate limits: checks 5/day per IP, 500/day global; contact 3/day per IP; notify 5/day per IP. The IP comes from `CF-Connecting-IP` and is stored only as HMAC-SHA256.
- Risk points: Critical 25, High 12, Medium 5, Low 1; devDependencies ×0.5. Labels: 85–100 *Healthy*, 60–84 *Needs attention*, < 60 *At risk*.
- Effort classes:
  - patch/minor 15 min (0.25 h);
  - rename 30 min (0.5 h);
  - major 4–8 h, plus 4 h per additional major;
  - replace 4–8 h;
  - `watch` 0 h (added for low-risk maintenance-only findings, so the plan isn't inflated).
- Cache keys: the `packages` collection holds every 24 h upstream cache entry, keyed by source (`npm:<name>`, `dl:<name>`, `osv:<name>@<version>`, `dd:<name>@<version>`). The spec says "`_id` = name"; the prefix lets one TTL collection serve all four sources.
- Retention: reports 30 days (the sample report never expires); package cache 24 h; advisories 7 days; rate limits 48 h; pending subscribers 7 days; unsubscribed subscribers 30 days; messages 180 days.
- Copy rules:
  - Never show the owner's name.
  - Speak as "an independent backend engineer" (one person, never "we").
  - The sender is `noticely <hello@noticely.dev>`.
- Security (spec §7):
  - Templates auto-escape all output.
  - No inline `<script>` and no `style=""` attributes (CSP `style-src 'self'`).
  - The only third-party origin is `https://challenges.cloudflare.com`.
  - The server never fetches URLs supplied by visitors.
- Git identity for this repo: `noticely <1142814+mariusbancos@users.noreply.github.com>`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Local MongoDB for tests: `mongo:8.2`, because the laptop's kernel 7.0 makes `mongo:8.0` refuse to start. CI and production use `mongo:8.0`.

## Review Focus

1. **A `package.json` with no dependencies** (or only `devDependencies`). Expected: the report renders with "No dependencies to check" or a healthy result, and score 100, never a crash. Pinned in Task 9 (`analyzeDeps`) and Task 12 (render).
2. **A lockfile that lacks some dependencies.** Expected: those dependencies fall back to the lowest matching version and are flagged worst-case, while the others use the exact lockfile versions. Pinned in Tasks 2 and 3.
3. **Unusual specs:** `"*"`, `""`, `"latest"`, a dist-tag like `"next"`, an unsatisfiable `"^99.0.0"`, or a garbage `"hello world"`. Expected: sensible resolution or a clear "not checked" reason, never a crash. Pinned in Task 3.
4. **One upstream down** (429/500 after retries, or a timeout). Expected: the report still completes, with a "partial data" banner naming the source. Pinned in Tasks 9 and 12.
5. **Repeated actions:** signing up twice, clicking a confirm link twice, or opening an unknown or expired unsubscribe link. Expected: friendly, idempotent pages and no duplicate emails. Pinned in Task 13.

## File Map

```
package.json, package-lock.json, tsconfig.json, tsconfig.build.json, eslint.config.js, vitest.config.ts
Makefile, Dockerfile, .dockerignore, renovate.json, LICENSE, README.md
.github/workflows/ci.yml
deploy/docker-compose.yml, deploy/deps.caddy, deploy/deps-mongo-dump.sh, deploy/env.example
data/replacements.json, data/sample-package.json
public/app.css, public/app.js, public/brand/*            (logo + favicons)
views/layout.eta, home.eta, report.eta, progress.eta, notice.eta, limit.eta,
      contact.eta, methodology.eta, privacy.eta, partials/notify-form.eta
scripts/selfcheck.ts, scripts/smoke.sh
src/main.ts                     process entry: wiring + listen + shutdown
src/config.ts                   env parsing (zod)
src/metrics.ts                  prom-client registry + adapters
src/analyze/types.ts            shared domain types
src/analyze/parse.ts            package.json/lockfile parsing + validation
src/analyze/resolve.ts          version resolution
src/analyze/rules.ts            findings + per-package risk
src/analyze/score.ts            score, label, counts
src/analyze/plan.ts             upgrade plan + effort formatting
src/analyze/replacements.ts     load/validate data/replacements.json
src/analyze/summary.ts          summary paragraph
src/store/db.ts                 connect + ensureIndexes
src/store/ids.ts                base62 report ids, tokens
src/store/cache.ts              CacheStore (mongo + memory)
src/store/reports.ts            reports repository
src/store/ratelimits.ts         atomic counters
src/store/subscribers.ts        notify-me lists
src/store/messages.ts           contact messages
src/sources/http.ts             getJson with timeout/retry/size cap
src/sources/limit.ts            mapLimit
src/sources/npm.ts, downloads.ts, osv.ts, depsdev.ts
src/sources/index.ts            createSources (cache + orchestration)
src/check/analyze-deps.ts       full analysis of stored deps (no DB)
src/check/runner.ts             queue + timeout + persistence
src/check/sample.ts             permanent sample report
src/mail/mailer.ts              Mailer (Resend / log / fake)
src/web/app.ts                  buildApp + security headers + error pages
src/web/views.ts                Eta setup + render helper
src/web/client-ip.ts, turnstile.ts, limits.ts, form-time.ts, format.ts, report-view.ts
src/web/routes/pages.ts, check.ts, report.ts, notify.ts, contact.ts, ops.ts
tests/helpers/mongo.ts, multipart.ts, fakes.ts
tests/unit/**  tests/integration/**
```

---
### Task 1: Project scaffold and configuration

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, `Makefile`, `.nvmrc`, `LICENSE`, `src/config.ts`
- Modify: `.gitignore`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?: NodeJS.ProcessEnv): Config`, plus the `Config` type with the fields `NODE_ENV, PORT, MONGO_URL, MONGO_DB, PUBLIC_URL, TURNSTILE_SITE_KEY, TURNSTILE_SECRET, RESEND_API_KEY, MAIL_FROM, CONTACT_TO, IP_HASH_SECRET, CHECKS_PER_DAY, GLOBAL_CHECKS_PER_DAY`.

- [ ] **Step 1: Create the package manifest and install pinned dependencies**

`package.json`:

```json
{
  "name": "deps",
  "version": "0.1.0",
  "private": true,
  "description": "Dependency health check for npm projects — deps.noticely.dev",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=24.10 <25" },
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/src/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "selfcheck": "tsx scripts/selfcheck.ts"
  }
}
```

Run:

```bash
cd ~/noticely/deps
echo "24" > .nvmrc
npm install --save-exact fastify@5.12.5 @fastify/formbody@9.0.0 @fastify/multipart@10.1.2 @fastify/static@10.1.5 \
  eta@4.6.0 zod@4.6.5 mongodb@7.6.0 semver@7.8.5 secure-json-parse@4.1.0 prom-client@15.1.3
npm install --save-exact --save-dev typescript@6.0.3 tsx@4.23.15 vitest@5.0.2 eslint@10.11.0 @eslint/js@10.0.1 \
  typescript-eslint@8.70.1 @types/node@24.19.0 @types/semver@7.8.0
```

Expected: `package-lock.json` is created, and `npm ls --depth=0` lists exactly these versions.

- [ ] **Step 2: TypeScript, ESLint and Vitest config**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "scripts", "tests", "vitest.config.ts"]
}
```

`tsconfig.build.json`:

```json
{ "extends": "./tsconfig.json", "include": ["src", "scripts"], "exclude": ["tests"] }
```

`eslint.config.js`:

```js
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default defineConfig([
  { ignores: ['dist/', 'docs/', 'public/', '.superpowers/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]);
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 20_000,
  },
});
```

Replace `.gitignore` with:

```
.superpowers/
node_modules/
dist/
.env
coverage/
```

- [ ] **Step 3: Write the failing config test**

`tests/unit/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(8080);
    expect(cfg.CHECKS_PER_DAY).toBe(5);
    expect(cfg.GLOBAL_CHECKS_PER_DAY).toBe(500);
    expect(cfg.MAIL_FROM).toBe('noticely <hello@noticely.dev>');
  });

  it('coerces numbers from strings', () => {
    expect(loadConfig({ PORT: '9000', CHECKS_PER_DAY: '7' })).toMatchObject({ PORT: 9000, CHECKS_PER_DAY: 7 });
  });

  it('refuses to start in production with development secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/IP_HASH_SECRET/);
  });

  it('accepts a complete production config', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://deps.noticely.dev',
      MONGO_URL: 'mongodb://u:p@deps-mongo:27017/?authSource=admin',
      TURNSTILE_SITE_KEY: '0x4AAAAAAAreal',
      TURNSTILE_SECRET: '0x4AAAAAAArealsecret',
      RESEND_API_KEY: 're_123',
      CONTACT_TO: 'owner@example.com',
      IP_HASH_SECRET: 'a'.repeat(32),
    });
    expect(cfg.NODE_ENV).toBe('production');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL, because `src/config.js` cannot be resolved.

- [ ] **Step 5: Implement `src/config.ts`**

```ts
import { z } from 'zod';

const DEV_SITE_KEY = '1x00000000000000000000AA';
const DEV_SECRET = '1x0000000000000000000000000000000AA';
const DEV_HASH_SECRET = 'dev-only-secret-change-me';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGO_URL: z.string().min(1).default('mongodb://localhost:27017'),
  MONGO_DB: z.string().min(1).default('deps'),
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  TURNSTILE_SITE_KEY: z.string().min(1).default(DEV_SITE_KEY),
  TURNSTILE_SECRET: z.string().min(1).default(DEV_SECRET),
  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().min(3).default('noticely <hello@noticely.dev>'),
  CONTACT_TO: z.string().default(''),
  IP_HASH_SECRET: z.string().min(16).default(DEV_HASH_SECRET),
  CHECKS_PER_DAY: z.coerce.number().int().positive().default(5),
  GLOBAL_CHECKS_PER_DAY: z.coerce.number().int().positive().default(500),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = Env.parse(env);
  if (cfg.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (cfg.IP_HASH_SECRET === DEV_HASH_SECRET) problems.push('IP_HASH_SECRET');
    if (cfg.TURNSTILE_SECRET === DEV_SECRET || cfg.TURNSTILE_SITE_KEY === DEV_SITE_KEY) problems.push('TURNSTILE_*');
    if (!cfg.RESEND_API_KEY) problems.push('RESEND_API_KEY');
    if (!cfg.CONTACT_TO) problems.push('CONTACT_TO');
    if (!cfg.PUBLIC_URL.startsWith('https://')) problems.push('PUBLIC_URL');
    if (problems.length) throw new Error(`Production config incomplete: ${problems.join(', ')}`);
  }
  return cfg;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Add the Makefile and LICENSE**

`Makefile` (recipe lines start with a TAB):

```make
TAG ?= latest
MONGO_TEST_IMAGE ?= mongo:8.2

.PHONY: db-up db-down test check deploy
db-up:
	docker run -d --rm --name deps-mongo-test -p 27017:27017 $(MONGO_TEST_IMAGE)
db-down:
	docker stop deps-mongo-test
test:
	MONGO_URL=mongodb://localhost:27017 npx vitest run
check:
	npm run lint && npm run typecheck && $(MAKE) test
deploy:
	ssh app-1 'cd /srv/deps && TAG=$(TAG) docker compose pull web && TAG=$(TAG) docker compose up -d'
	./scripts/smoke.sh https://deps.noticely.dev
```

`LICENSE`: the standard MIT text, beginning `MIT License` / `Copyright (c) 2026 noticely`.

- [ ] **Step 8: Lint, typecheck and commit**

Run: `npm run lint && npm run typecheck`
Expected: no errors.

```bash
git add -A
git commit -m "chore: scaffold TypeScript/Fastify project and config loading

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domain types and input parsing

**Files:**
- Create: `src/analyze/types.ts`, `src/analyze/parse.ts`
- Test: `tests/unit/parse.test.ts`

**Interfaces:**
- Produces, in `types.ts`, all the shared types used by later tasks (complete file below).
- Produces, in `parse.ts`:
  - `parseInput(packageJsonText: string, lockfileText: string | null): ParsedInput`
  - `class InputError extends Error { userMessage: string }`
  - `LIMITS`
  - `isValidPackageName(name: string): boolean`

- [ ] **Step 1: Create `src/analyze/types.ts`**

```ts
export type Scope = 'prod' | 'dev';
export type Risk = 'critical' | 'high' | 'medium' | 'low' | 'healthy';
export type Resolution =
  | 'lockfile' | 'range-min' | 'tag' | 'not-found' | 'no-match' | 'invalid-spec' | 'unavailable';
export type SourceName = 'npm' | 'downloads' | 'osv' | 'deps.dev';
export type EffortClass = 'patch' | 'rename' | 'major' | 'replace' | 'watch';

/** A dependency as stored on the report (from package.json + optional lockfile). */
export interface StoredDep {
  name: string;
  spec: string;
  scope: Scope;
  lockVersion: string | null;
}

export interface SkippedDep {
  name: string;
  spec: string;
  scope: Scope;
  reason: string;
}

export interface ParsedInput {
  projectName: string;
  hasLockfile: boolean;
  deps: StoredDep[];
  skipped: SkippedDep[];
}

export interface ResolvedDep extends StoredDep {
  resolved: string | null;
  resolution: Resolution;
}

export interface NpmInfo {
  found: boolean;
  latest: string | null;
  distTags: Record<string, string>;
  versions: string[];
  lastPublish: string | null; // ISO date of the most recent version publish
  maintainers: number;
  deprecatedLatest: string | null;
  deprecated: Record<string, string>; // version -> message (only deprecated versions)
}

export interface DepsDevInfo {
  repo: string | null;
  scorecard: number | null;
  stars: number | null;
}

export interface RangeEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

export interface Advisory {
  id: string;
  summary: string;
  severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW' | null;
  npmRanges: Record<string, RangeEvent[][]>; // npm package name -> list of SEMVER ranges (event lists)
}

export interface PackageData {
  npm: NpmInfo | undefined;
  downloads: number | null;
  depsdev: DepsDevInfo | null;
  vulnIds: string[] | null; // null = OSV unavailable for this package
}

export type FindingKind =
  | 'vulnerability' | 'deprecated' | 'version-deprecated' | 'idle' | 'single-maintainer' | 'majors-behind';

export interface Finding {
  kind: FindingKind;
  risk: Risk;
  text: string;
}

export interface VulnResult {
  id: string;
  risk: Risk;
  summary: string;
  fixedIn: string | null;
}

export interface PackageResult {
  name: string;
  scope: Scope;
  spec: string;
  resolved: string | null;
  resolution: Resolution;
  status: 'checked' | 'not-found' | 'unresolved';
  latest: string | null;
  lastPublish: string | null;
  maintainers: number | null;
  downloads: number | null;
  scorecard: number | null;
  stars: number | null;
  deprecated: string | null;
  vulns: VulnResult[];
  findings: Finding[];
  risk: Risk;
  majorsBehind: number | null;
  worstCase: boolean;
}

export interface Counts {
  total: number;
  checked: number;
  vulnerabilities: number;
  criticalVulns: number;
  deprecated: number;
  maintenance: number;
  majorsBehind: number;
}

export interface Replacement {
  suggestion: string;
  effort: EffortClass;
}

export interface PlanStep {
  name: string;
  scope: Scope;
  risk: Risk;
  action: string;
  effort: EffortClass;
  minHours: number;
  maxHours: number;
}

export interface Plan {
  steps: PlanStep[];
  totalMinHours: number;
  totalMaxHours: number;
}

export type ScoreLabel = 'Healthy' | 'Needs attention' | 'At risk';

export interface ReportResult {
  score: number;
  label: ScoreLabel;
  summary: string;
  counts: Counts;
  packages: PackageResult[];
  plan: Plan;
  partial: SourceName[];
}

export const RISK_ORDER: Record<Risk, number> = { critical: 4, high: 3, medium: 2, low: 1, healthy: 0 };
export const RISK_POINTS: Record<Risk, number> = { critical: 25, high: 12, medium: 5, low: 1, healthy: 0 };

export function worstRisk(risks: Risk[]): Risk {
  return risks.reduce<Risk>((w, r) => (RISK_ORDER[r] > RISK_ORDER[w] ? r : w), 'healthy');
}
```

- [ ] **Step 2: Write the failing parse tests**

`tests/unit/parse.test.ts`:

```ts
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

  it('rejects lockfile v1 and invalid lockfiles', () => {
    expect(() => parseInput('{}', pkg({ lockfileVersion: 1, dependencies: {} }))).toThrow(/lockfile v2 or v3/);
    expect(() => parseInput('{}', 'nope')).toThrow(/lockfile is not valid JSON/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/parse.test.ts`
Expected: FAIL, because `src/analyze/parse.js` cannot be resolved.

- [ ] **Step 4: Implement `src/analyze/parse.ts`**

```ts
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
    value = sjson.parse(text.replace(/^﻿/, ''), undefined, { protoAction: 'error', constructorAction: 'error' });
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/parse.test.ts`
Expected: PASS. If the `__proto__` case reports a different message, check that `protoAction: 'error'` makes `secure-json-parse` throw. It must throw, and the catch must convert that into `This is not valid JSON`.

- [ ] **Step 6: Commit**

```bash
git add src/analyze tests/unit/parse.test.ts
git commit -m "feat(analyze): domain types and safe package.json/lockfile parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Version resolution

**Files:**
- Create: `src/analyze/resolve.ts`
- Test: `tests/unit/resolve.test.ts`

**Interfaces:**
- Consumes `StoredDep`, `NpmInfo` and `ResolvedDep` from `types.ts`.
- Produces `resolveDep(dep: StoredDep, npm: NpmInfo | undefined, npmUnavailable: boolean): ResolvedDep`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/resolve.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/resolve.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `src/analyze/resolve.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/resolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyze/resolve.ts tests/unit/resolve.test.ts
git commit -m "feat(analyze): resolve versions from lockfile, tags or lowest matching range

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rules, findings and per-package risk

**Files:**
- Create: `src/analyze/rules.ts`
- Test: `tests/unit/rules.test.ts`

**Interfaces:**
- Consumes `ResolvedDep`, `PackageData`, `Advisory`, `PackageResult` and `worstRisk` from `types.ts`.
- Produces:
  - `evaluatePackage(dep: ResolvedDep, data: PackageData | undefined, advisories: Map<string, Advisory>, now: Date): PackageResult`
  - `fixedVersionFor(adv: Advisory, name: string, version: string): string | null`
  - `IDLE_DAYS = 730`

- [ ] **Step 1: Write the failing tests**

`tests/unit/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evaluatePackage, fixedVersionFor } from '../../src/analyze/rules.js';
import type { Advisory, NpmInfo, PackageData, ResolvedDep } from '../../src/analyze/types.js';

const now = new Date('2026-10-12T00:00:00Z');
const npm = (o: Partial<NpmInfo> = {}): NpmInfo => ({
  found: true, latest: '2.0.0', distTags: { latest: '2.0.0' }, versions: ['1.0.0', '2.0.0'],
  lastPublish: '2026-06-01T00:00:00Z', maintainers: 3, deprecatedLatest: null, deprecated: {}, ...o,
});
const data = (o: Partial<PackageData> = {}): PackageData => ({
  npm: npm(), downloads: 1000, depsdev: { repo: 'github.com/a/b', scorecard: 7.5, stars: 10 }, vulnIds: [], ...o,
});
const dep = (o: Partial<ResolvedDep> = {}): ResolvedDep => ({
  name: 'pkg', spec: '^2.0.0', scope: 'prod', lockVersion: null, resolved: '2.0.0', resolution: 'lockfile', ...o,
});
const lodashAdv: Advisory = {
  id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
  npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] },
};

describe('fixedVersionFor', () => {
  it('finds the fixing version for the affected range', () => {
    expect(fixedVersionFor(lodashAdv, 'lodash', '4.17.15')).toBe('4.17.21');
    expect(fixedVersionFor(lodashAdv, 'lodash', '4.17.21')).toBeNull();
    expect(fixedVersionFor({ ...lodashAdv, npmRanges: { x: [[{ introduced: '0' }, { last_affected: '1.0.0' }]] } }, 'x', '0.5.0')).toBeNull();
  });
});

describe('evaluatePackage', () => {
  it('marks a healthy package', () => {
    const r = evaluatePackage(dep(), data(), new Map(), now);
    expect(r).toMatchObject({ status: 'checked', risk: 'healthy', findings: [], scorecard: 7.5, downloads: 1000, worstCase: false });
  });

  it('maps advisories to vulnerabilities with fix versions', () => {
    const r = evaluatePackage(
      dep({ name: 'lodash', resolved: '4.17.15', resolution: 'range-min' }),
      data({ npm: npm({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }), vulnIds: ['GHSA-35jh-r3h4-6jhm', 'GHSA-unknown'] }),
      new Map([[lodashAdv.id, lodashAdv]]), now);
    expect(r.vulns).toEqual([
      { id: 'GHSA-35jh-r3h4-6jhm', risk: 'high', summary: 'Command Injection in lodash', fixedIn: '4.17.21' },
      { id: 'GHSA-unknown', risk: 'medium', summary: 'Details unavailable', fixedIn: null },
    ]);
    expect(r.findings[0]).toEqual({ kind: 'vulnerability', risk: 'high', text: '2 known vulnerabilities' });
    expect(r.risk).toBe('high');
    expect(r.worstCase).toBe(true);
  });

  it('flags a deprecated package as high and a deprecated version as medium', () => {
    const whole = evaluatePackage(dep(), data({ npm: npm({ deprecatedLatest: 'use undici', deprecated: { '2.0.0': 'use undici' } }) }), new Map(), now);
    expect(whole.risk).toBe('high');
    expect(whole.deprecated).toBe('use undici');
    const version = evaluatePackage(dep({ resolved: '1.0.0' }), data({ npm: npm({ deprecated: { '1.0.0': 'bug, upgrade' } }) }), new Map(), now);
    expect(version.findings.map((f) => [f.kind, f.risk])).toContainEqual(['version-deprecated', 'medium']);
  });

  it('flags idle and single-maintainer packages', () => {
    const r = evaluatePackage(dep(), data({ npm: npm({ lastPublish: '2018-04-01T00:00:00Z', maintainers: 1 }) }), new Map(), now);
    expect(r.findings.map((f) => [f.kind, f.risk])).toEqual([['idle', 'medium'], ['single-maintainer', 'medium']]);
    expect(r.findings[0]?.text).toBe('No release for 8 years');
    const single = evaluatePackage(dep(), data({ npm: npm({ maintainers: 1 }) }), new Map(), now);
    expect(single.findings).toEqual([{ kind: 'single-maintainer', risk: 'low', text: 'Single maintainer' }]);
  });

  it('counts major versions behind', () => {
    const two = evaluatePackage(dep({ resolved: '6.12.0' }), data({ npm: npm({ latest: '8.19.1' }) }), new Map(), now);
    expect(two).toMatchObject({ majorsBehind: 2, risk: 'low' });
    const three = evaluatePackage(dep({ resolved: '1.0.0' }), data({ npm: npm({ latest: '4.0.0' }) }), new Map(), now);
    expect(three.risk).toBe('medium');
  });

  it('reports packages that could not be checked', () => {
    expect(evaluatePackage(dep({ resolved: null, resolution: 'not-found' }), undefined, new Map(), now))
      .toMatchObject({ status: 'not-found', risk: 'healthy' });
    expect(evaluatePackage(dep({ resolved: null, resolution: 'unavailable' }), undefined, new Map(), now).status).toBe('unresolved');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/rules.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `src/analyze/rules.ts`**

```ts
import semver from 'semver';
import { worstRisk, type Advisory, type Finding, type PackageData, type PackageResult, type ResolvedDep, type Risk, type VulnResult } from './types.js';

export const IDLE_DAYS = 730;
const DAY_MS = 86_400_000;

const SEVERITY_RISK: Record<NonNullable<Advisory['severity']>, Risk> = {
  CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', LOW: 'low',
};

export function fixedVersionFor(adv: Advisory, name: string, version: string): string | null {
  const ranges = Object.hasOwn(adv.npmRanges, name) ? adv.npmRanges[name] ?? [] : [];
  let best: string | null = null;
  for (const events of ranges) {
    let introduced = '0';
    for (const ev of events) {
      if (ev.introduced !== undefined) introduced = ev.introduced;
      if (ev.fixed && semver.valid(ev.fixed)) {
        const afterStart = introduced === '0' || (semver.valid(introduced) !== null && semver.gte(version, introduced));
        if (afterStart && semver.lt(version, ev.fixed) && (best === null || semver.lt(ev.fixed, best))) best = ev.fixed;
      }
    }
  }
  return best;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function evaluatePackage(
  dep: ResolvedDep, data: PackageData | undefined, advisories: Map<string, Advisory>, now: Date,
): PackageResult {
  const npm = data?.npm;
  const base: PackageResult = {
    name: dep.name, scope: dep.scope, spec: dep.spec, resolved: dep.resolved, resolution: dep.resolution,
    status: 'checked', latest: npm?.latest ?? null, lastPublish: npm?.lastPublish ?? null,
    maintainers: npm?.found ? npm.maintainers : null, downloads: data?.downloads ?? null,
    scorecard: data?.depsdev?.scorecard ?? null, stars: data?.depsdev?.stars ?? null,
    deprecated: null, vulns: [], findings: [], risk: 'healthy', majorsBehind: null,
    worstCase: dep.resolution === 'range-min',
  };
  if (dep.resolution === 'not-found') return { ...base, status: 'not-found' };
  if (!dep.resolved || !npm?.found) return { ...base, status: 'unresolved' };
  const version = dep.resolved;
  const findings: Finding[] = [];

  // Vulnerabilities
  const vulns: VulnResult[] = (data?.vulnIds ?? []).map((id) => {
    const adv = advisories.get(id);
    if (!adv) return { id, risk: 'medium', summary: 'Details unavailable', fixedIn: null };
    return {
      id, risk: adv.severity ? SEVERITY_RISK[adv.severity] : 'medium',
      summary: adv.summary, fixedIn: fixedVersionFor(adv, dep.name, version),
    };
  });
  if (vulns.length) {
    findings.push({ kind: 'vulnerability', risk: worstRisk(vulns.map((v) => v.risk)), text: plural(vulns.length, 'known vulnerability', 'known vulnerabilities') });
  }

  // Deprecation
  let deprecated: string | null = null;
  if (npm.deprecatedLatest) {
    deprecated = npm.deprecatedLatest;
    findings.push({ kind: 'deprecated', risk: 'high', text: 'Deprecated by its authors' });
  } else if (Object.hasOwn(npm.deprecated, version)) {
    deprecated = npm.deprecated[version] ?? null;
    findings.push({ kind: 'version-deprecated', risk: 'medium', text: `Version ${version} is deprecated` });
  }

  // Maintenance
  const idleDays = npm.lastPublish ? (now.getTime() - Date.parse(npm.lastPublish)) / DAY_MS : 0;
  const idle = idleDays > IDLE_DAYS;
  if (idle) findings.push({ kind: 'idle', risk: 'medium', text: `No release for ${Math.floor(idleDays / 365)} years` });
  if (npm.maintainers === 1) findings.push({ kind: 'single-maintainer', risk: idle ? 'medium' : 'low', text: 'Single maintainer' });

  // Majors behind
  let majorsBehind: number | null = null;
  if (npm.latest && semver.valid(npm.latest) && semver.valid(version)) {
    majorsBehind = Math.max(0, semver.major(npm.latest) - semver.major(version));
    if (majorsBehind >= 1) {
      findings.push({ kind: 'majors-behind', risk: majorsBehind >= 3 ? 'medium' : 'low', text: `${plural(majorsBehind, 'major version', 'major versions')} behind` });
    }
  }

  return { ...base, deprecated, vulns, findings, majorsBehind, risk: worstRisk(findings.map((f) => f.risk)) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyze/rules.ts tests/unit/rules.test.ts
git commit -m "feat(analyze): findings for vulnerabilities, deprecation, maintenance and majors behind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Score, counts, upgrade plan and replacements

**Files:**
- Create: `src/analyze/score.ts`, `src/analyze/plan.ts`, `src/analyze/replacements.ts`, `data/replacements.json`
- Test: `tests/helpers/package-result.ts`, `tests/unit/score.test.ts`, `tests/unit/plan.test.ts`

**Interfaces:**
- Consumes `PackageResult`, `Counts`, `Plan`, `PlanStep`, `Replacement`, `RISK_POINTS` and `RISK_ORDER` from `types.ts`.
- Produces:
  - `computeScore(pkgs: PackageResult[]): { score: number; label: ScoreLabel }`
  - `computeCounts(pkgs: PackageResult[]): Counts`
  - `buildPlan(pkgs: PackageResult[], replacements: Record<string, Replacement>): Plan`
  - `formatEffort(minHours: number, maxHours: number): string`
  - `loadReplacements(file: string): Record<string, Replacement>`

- [ ] **Step 1: Write the failing tests**

`tests/helpers/package-result.ts` (a shared builder; test files must not import each other):

```ts
import type { PackageResult } from '../../src/analyze/types.js';

export const pr = (o: Partial<PackageResult> = {}): PackageResult => ({
  name: 'p', scope: 'prod', spec: '1.0.0', resolved: '1.0.0', resolution: 'lockfile', status: 'checked',
  latest: '1.0.0', lastPublish: null, maintainers: 2, downloads: 10, scorecard: null, stars: null,
  deprecated: null, vulns: [], findings: [], risk: 'healthy', majorsBehind: 0, worstCase: false, ...o,
});
```

`tests/unit/score.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeCounts, computeScore } from '../../src/analyze/score.js';
import { pr } from '../helpers/package-result.js';

describe('computeScore', () => {
  it('is 100 and Healthy without risks or dependencies', () => {
    expect(computeScore([])).toEqual({ score: 100, label: 'Healthy' });
    expect(computeScore([pr()])).toEqual({ score: 100, label: 'Healthy' });
  });

  it('subtracts risk points, dev dependencies at half weight', () => {
    // 100 - 25 - 12 - 5*0.5 - 1 = 59.5 -> 60 (Needs attention)
    const pkgs = [pr({ risk: 'critical' }), pr({ risk: 'high' }), pr({ risk: 'medium', scope: 'dev' }), pr({ risk: 'low' })];
    expect(computeScore(pkgs)).toEqual({ score: 60, label: 'Needs attention' });
  });

  it('ignores packages that were not checked and clamps at 0', () => {
    expect(computeScore([pr({ risk: 'critical', status: 'not-found' })]).score).toBe(100);
    expect(computeScore(Array.from({ length: 5 }, () => pr({ risk: 'critical' })))).toEqual({ score: 0, label: 'At risk' });
  });
});

describe('computeCounts', () => {
  it('counts vulnerabilities, deprecations, maintenance and majors', () => {
    const c = computeCounts([
      pr({ vulns: [{ id: 'a', risk: 'critical', summary: '', fixedIn: null }, { id: 'b', risk: 'low', summary: '', fixedIn: null }] }),
      pr({ findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ findings: [{ kind: 'idle', risk: 'medium', text: '' }, { kind: 'single-maintainer', risk: 'medium', text: '' }] }),
      pr({ majorsBehind: 2 }),
      pr({ status: 'not-found', majorsBehind: null }),
    ]);
    expect(c).toEqual({ total: 5, checked: 4, vulnerabilities: 2, criticalVulns: 1, deprecated: 1, maintenance: 1, majorsBehind: 1 });
  });
});
```

`tests/unit/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPlan, formatEffort } from '../../src/analyze/plan.js';
import { loadReplacements } from '../../src/analyze/replacements.js';
import { pr } from '../helpers/package-result.js';

const repl = { request: { suggestion: 'native fetch or undici', effort: 'replace' as const }, 'node-uuid': { suggestion: 'uuid', effort: 'rename' as const } };

describe('formatEffort', () => {
  it.each([
    [0.25, 0.25, '15 min'], [0.5, 0.5, '30 min'], [0, 0, 'no work'], [2, 3, '2–3 h'],
    [4, 8, '0.5–1 day'], [20, 36, '2.5–4.5 days'], [8, 8, '1 day'],
  ])('%d–%d h → %s', (min, max, out) => expect(formatEffort(min, max)).toBe(out));
});

describe('buildPlan', () => {
  it('orders by risk removed per hour and totals the estimates', () => {
    const plan = buildPlan([
      pr({ name: 'express', risk: 'healthy' }),
      pr({ name: 'mongoose', resolved: '6.12.0', latest: '8.19.1', majorsBehind: 2, risk: 'low', findings: [{ kind: 'majors-behind', risk: 'low', text: '' }] }),
      pr({ name: 'request', risk: 'high', deprecated: 'deprecated', findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ name: 'node-uuid', risk: 'high', deprecated: 'renamed', findings: [{ kind: 'deprecated', risk: 'high', text: '' }] }),
      pr({ name: 'lodash', resolved: '4.17.15', risk: 'high', vulns: [
        { id: 'a', risk: 'high', summary: '', fixedIn: '4.17.21' }, { id: 'b', risk: 'medium', summary: '', fixedIn: '4.17.16' }],
        findings: [{ kind: 'vulnerability', risk: 'high', text: '' }] }),
      pr({ name: 'left-pad', risk: 'low', findings: [{ kind: 'single-maintainer', risk: 'low', text: '' }] }),
    ], repl);
    expect(plan.steps.map((s) => [s.name, s.action, s.effort])).toEqual([
      ['lodash', 'Upgrade to 4.17.21', 'patch'],
      ['node-uuid', 'Replace with uuid', 'rename'],
      ['request', 'Replace with native fetch or undici', 'replace'],
      ['mongoose', 'Upgrade to 8.19.1', 'major'],
      ['left-pad', 'Keep an eye on it (single maintainer)', 'watch'],
    ]);
    expect(plan.steps[3]).toMatchObject({ minHours: 8, maxHours: 12 });
    expect([plan.totalMinHours, plan.totalMaxHours]).toEqual([12.75, 20.75]);
  });

  it('suggests replacing when no fix exists and handles an empty input', () => {
    const plan = buildPlan([pr({ name: 'x', risk: 'critical', vulns: [{ id: 'a', risk: 'critical', summary: '', fixedIn: null }],
      findings: [{ kind: 'vulnerability', risk: 'critical', text: '' }] })], {});
    expect(plan.steps[0]).toMatchObject({ action: 'Replace or mitigate — no fixed version yet', effort: 'replace' });
    expect(buildPlan([], {})).toEqual({ steps: [], totalMinHours: 0, totalMaxHours: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/score.test.ts tests/unit/plan.test.ts`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement `src/analyze/score.ts`**

```ts
import { RISK_POINTS, type Counts, type PackageResult, type ScoreLabel } from './types.js';

export function computeScore(pkgs: PackageResult[]): { score: number; label: ScoreLabel } {
  let penalty = 0;
  for (const p of pkgs) {
    if (p.status !== 'checked') continue;
    penalty += RISK_POINTS[p.risk] * (p.scope === 'dev' ? 0.5 : 1);
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const label: ScoreLabel = score >= 85 ? 'Healthy' : score >= 60 ? 'Needs attention' : 'At risk';
  return { score, label };
}

export function computeCounts(pkgs: PackageResult[]): Counts {
  const checked = pkgs.filter((p) => p.status === 'checked');
  const has = (p: PackageResult, kinds: string[]) => p.findings.some((f) => kinds.includes(f.kind));
  return {
    total: pkgs.length,
    checked: checked.length,
    vulnerabilities: checked.reduce((n, p) => n + p.vulns.length, 0),
    criticalVulns: checked.reduce((n, p) => n + p.vulns.filter((v) => v.risk === 'critical').length, 0),
    deprecated: checked.filter((p) => has(p, ['deprecated', 'version-deprecated'])).length,
    maintenance: checked.filter((p) => has(p, ['idle', 'single-maintainer'])).length,
    majorsBehind: checked.filter((p) => (p.majorsBehind ?? 0) >= 1).length,
  };
}
```

- [ ] **Step 4: Implement `src/analyze/plan.ts`**

```ts
import semver from 'semver';
import { RISK_ORDER, RISK_POINTS, type EffortClass, type PackageResult, type Plan, type PlanStep, type Replacement } from './types.js';

function hours(effort: EffortClass, majors = 1): [number, number] {
  switch (effort) {
    case 'patch': return [0.25, 0.25];
    case 'rename': return [0.5, 0.5];
    case 'major': return [4 + 4 * (majors - 1), 8 + 4 * (majors - 1)];
    case 'replace': return [4, 8];
    case 'watch': return [0, 0];
  }
}

function upgradeEffort(from: string | null, to: string): { effort: EffortClass; majors: number } {
  if (!from || !semver.valid(from) || !semver.valid(to)) return { effort: 'major', majors: 1 };
  const majors = semver.major(to) - semver.major(from);
  return majors >= 1 ? { effort: 'major', majors } : { effort: 'patch', majors: 0 };
}

function stepFor(p: PackageResult, replacements: Record<string, Replacement>): Omit<PlanStep, 'minHours' | 'maxHours'> & { majors: number } | null {
  const kinds = new Set(p.findings.map((f) => f.kind));
  const repl = Object.hasOwn(replacements, p.name) ? replacements[p.name] : undefined;
  const base = { name: p.name, scope: p.scope, risk: p.risk };
  if (kinds.has('deprecated')) {
    return repl
      ? { ...base, action: `Replace with ${repl.suggestion}`, effort: repl.effort, majors: 1 }
      : { ...base, action: `Replace ${p.name} (deprecated)`, effort: 'replace', majors: 1 };
  }
  if (p.vulns.length) {
    const fixes = p.vulns.map((v) => v.fixedIn).filter((v): v is string => v !== null);
    if (fixes.length < p.vulns.length || fixes.length === 0) {
      return { ...base, action: 'Replace or mitigate — no fixed version yet', effort: 'replace', majors: 1 };
    }
    const target = fixes.reduce((a, b) => (semver.gt(b, a) ? b : a));
    const { effort, majors } = upgradeEffort(p.resolved, target);
    return { ...base, action: `Upgrade to ${target}`, effort, majors };
  }
  if ((kinds.has('version-deprecated') || kinds.has('majors-behind')) && p.latest) {
    const { effort, majors } = upgradeEffort(p.resolved, p.latest);
    return { ...base, action: `Upgrade to ${p.latest}`, effort, majors };
  }
  if (kinds.has('idle') || kinds.has('single-maintainer')) {
    if (repl) return { ...base, action: `Replace with ${repl.suggestion}`, effort: repl.effort, majors: 1 };
    if (p.risk === 'low') return { ...base, action: 'Keep an eye on it (single maintainer)', effort: 'watch', majors: 0 };
    return { ...base, action: 'Review for a maintained alternative', effort: 'replace', majors: 1 };
  }
  return null;
}

export function buildPlan(pkgs: PackageResult[], replacements: Record<string, Replacement>): Plan {
  const steps: PlanStep[] = [];
  for (const p of pkgs) {
    if (p.status !== 'checked' || p.risk === 'healthy') continue;
    const s = stepFor(p, replacements);
    if (!s) continue;
    const [minHours, maxHours] = hours(s.effort, s.majors);
    steps.push({ name: s.name, scope: s.scope, risk: s.risk, action: s.action, effort: s.effort, minHours, maxHours });
  }
  const value = (s: PlanStep) => {
    if (s.effort === 'watch') return -1;
    return (RISK_POINTS[s.risk] * (s.scope === 'dev' ? 0.5 : 1)) / Math.max((s.minHours + s.maxHours) / 2, 0.25);
  };
  steps.sort((a, b) => value(b) - value(a) || RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.name.localeCompare(b.name));
  return {
    steps,
    totalMinHours: steps.reduce((n, s) => n + s.minHours, 0),
    totalMaxHours: steps.reduce((n, s) => n + s.maxHours, 0),
  };
}

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function formatEffort(minHours: number, maxHours: number): string {
  if (maxHours === 0) return 'no work';
  if (maxHours < 1) {
    const a = Math.round(minHours * 60), b = Math.round(maxHours * 60);
    return a === b ? `${b} min` : `${a}–${b} min`;
  }
  if (maxHours < 4) return minHours === maxHours ? `${trim(maxHours)} h` : `${trim(minHours)}–${trim(maxHours)} h`;
  const a = minHours / 8, b = maxHours / 8;
  const unit = b <= 1 ? 'day' : 'days';
  return a === b ? `${trim(b)} ${unit}` : `${trim(a)}–${trim(b)} ${unit}`;
}
```

Check against the test: lodash 12 points / 0.25 h = 48; node-uuid 12/0.5 = 24; request 12/6 = 2; mongoose 1/10 = 0.1; left-pad is `watch` and goes last. Totals: 0.25 + 0.5 + 4 + 8 + 0 = 12.75 (min) and 0.25 + 0.5 + 8 + 12 + 0 = 20.75 (max).

- [ ] **Step 5: Implement `src/analyze/replacements.ts` and `data/replacements.json`**

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Replacement } from './types.js';

const Schema = z.record(z.string().min(1), z.strictObject({
  suggestion: z.string().min(1).max(120),
  effort: z.enum(['patch', 'rename', 'major', 'replace', 'watch']),
}));

export function loadReplacements(file: string): Record<string, Replacement> {
  const parsed = Schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  return Object.assign(Object.create(null) as Record<string, Replacement>, parsed);
}
```

`data/replacements.json`:

```json
{
  "request": { "suggestion": "native fetch or undici", "effort": "replace" },
  "request-promise": { "suggestion": "native fetch or undici", "effort": "replace" },
  "request-promise-native": { "suggestion": "native fetch or undici", "effort": "replace" },
  "node-uuid": { "suggestion": "uuid", "effort": "rename" },
  "moment": { "suggestion": "luxon or date-fns", "effort": "replace" },
  "left-pad": { "suggestion": "String.prototype.padStart", "effort": "patch" },
  "querystring": { "suggestion": "URLSearchParams", "effort": "rename" },
  "mkdirp": { "suggestion": "fs.mkdir with { recursive: true }", "effort": "rename" },
  "node-sass": { "suggestion": "sass", "effort": "rename" },
  "tslint": { "suggestion": "ESLint with typescript-eslint", "effort": "replace" },
  "babel-eslint": { "suggestion": "@babel/eslint-parser", "effort": "rename" },
  "core-js-pure": { "suggestion": "core-js 3", "effort": "major" }
}
```

Add this test at the end of `tests/unit/plan.test.ts` (the import is already at the top):

```ts
it('loads the bundled replacements file', () => {
  const r = loadReplacements('data/replacements.json');
  expect(r['node-uuid']).toEqual({ suggestion: 'uuid', effort: 'rename' });
  expect(Object.getPrototypeOf(r)).toBeNull();
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/score.test.ts tests/unit/plan.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analyze data tests/unit
git commit -m "feat(analyze): health score, counts and prioritised upgrade plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Summary paragraph

**Files:**
- Create: `src/analyze/summary.ts`
- Test: `tests/unit/summary.test.ts`

**Interfaces:**
- Consumes `Counts` and `Plan` from `types.ts`, and `formatEffort` from `plan.ts`.
- Produces `buildSummary(counts: Counts, plan: Plan, allVulnsFixable: boolean): string`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSummary } from '../../src/analyze/summary.js';
import type { Counts } from '../../src/analyze/types.js';

const counts = (o: Partial<Counts> = {}): Counts => ({
  total: 12, checked: 12, vulnerabilities: 0, criticalVulns: 0, deprecated: 0, maintenance: 0, majorsBehind: 0, ...o,
});
const noPlan = { steps: [], totalMinHours: 0, totalMaxHours: 0 };

describe('buildSummary', () => {
  it('handles nothing to check', () => {
    expect(buildSummary(counts({ total: 0, checked: 0 }), noPlan, true)).toBe('No dependencies to check.');
    expect(buildSummary(counts({ total: 3, checked: 0 }), noPlan, true))
      .toBe('None of the 3 dependencies could be checked against the public npm registry.');
  });

  it('reports a healthy project', () => {
    expect(buildSummary(counts(), noPlan, true))
      .toBe('All 12 checked dependencies look healthy: no known vulnerabilities, nothing deprecated or abandoned.');
  });

  it('lists the problems and the plan estimate', () => {
    const plan = { steps: [{ name: 'a', scope: 'prod' as const, risk: 'high' as const, action: '', effort: 'patch' as const, minHours: 8, maxHours: 12 }], totalMinHours: 8, totalMaxHours: 12 };
    expect(buildSummary(counts({ vulnerabilities: 7, criticalVulns: 1, deprecated: 2, maintenance: 3, majorsBehind: 5 }), plan, true))
      .toBe('7 known vulnerabilities (1 critical) with available fixes, 2 deprecated packages, 3 packages with maintenance risk and 5 packages at least one major version behind. Working through the upgrade plan takes an estimated 1–1.5 days.');
    expect(buildSummary(counts({ vulnerabilities: 1 }), plan, false))
      .toBe('1 known vulnerability. Working through the upgrade plan takes an estimated 1–1.5 days.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/summary.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `src/analyze/summary.ts`**

```ts
import { formatEffort } from './plan.js';
import type { Counts, Plan } from './types.js';

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function buildSummary(counts: Counts, plan: Plan, allVulnsFixable: boolean): string {
  if (counts.total === 0) return 'No dependencies to check.';
  if (counts.checked === 0) {
    return `None of the ${n(counts.total, 'dependency', 'dependencies')} could be checked against the public npm registry.`;
  }
  const parts: string[] = [];
  if (counts.vulnerabilities > 0) {
    let s = n(counts.vulnerabilities, 'known vulnerability', 'known vulnerabilities');
    if (counts.criticalVulns > 0) s += ` (${counts.criticalVulns} critical)`;
    if (allVulnsFixable) s += ' with available fixes';
    parts.push(s);
  }
  if (counts.deprecated > 0) parts.push(n(counts.deprecated, 'deprecated package', 'deprecated packages'));
  if (counts.maintenance > 0) parts.push(`${n(counts.maintenance, 'package', 'packages')} with maintenance risk`);
  if (counts.majorsBehind > 0) parts.push(`${n(counts.majorsBehind, 'package', 'packages')} at least one major version behind`);

  if (parts.length === 0) {
    return `All ${counts.checked} checked dependencies look healthy: no known vulnerabilities, nothing deprecated or abandoned.`;
  }
  let text = `${joinList(parts)}.`;
  if (plan.totalMaxHours > 0) text += ` Working through the upgrade plan takes an estimated ${formatEffort(plan.totalMinHours, plan.totalMaxHours)}.`;
  return text;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyze/summary.ts tests/unit/summary.test.ts
git commit -m "feat(analyze): plain-English summary paragraph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: MongoDB store (connection, indexes, repositories)

**Files:**
- Create: `src/store/db.ts`, `src/store/ids.ts`, `src/store/cache.ts`, `src/store/reports.ts`, `src/store/ratelimits.ts`
- Create: `tests/helpers/mongo.ts`
- Test: `tests/integration/store.test.ts`

Local prerequisite: run `make db-up` once to start `mongo:8.2` on `localhost:27017`.

**Interfaces:**
- Produces:
  - `connect(url: string, dbName: string): Promise<{ client: MongoClient; db: Db }>`
  - `ensureIndexes(db: Db): Promise<void>`
  - `newReportId(): string` (22-char base62), `newToken(): string` (43-char base64url), `hashToken(t: string): string` (sha256 hex)
  - `interface CacheStore { get<T>(key: string): Promise<{ value: T } | null>; set<T>(key: string, value: T): Promise<void> }`
  - `mongoCache(coll: Collection<CacheDoc>): CacheStore`, `memoryCache(): CacheStore`
  - `interface ReportDoc`; `createReport`, `getReport`, `setReportResult`, `setReportFailed`, `upsertSampleReport`
  - `hitLimit(db: Db, key: string, limit: number, now: Date): Promise<{ allowed: boolean; count: number }>`

- [ ] **Step 1: Write the test helper and the failing tests**

`tests/helpers/mongo.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { connect, ensureIndexes } from '../../src/store/db.js';

export async function testDb() {
  const { client, db } = await connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017', `test_${randomBytes(6).toString('hex')}`);
  await ensureIndexes(db);
  return {
    db,
    async close() {
      await db.dropDatabase();
      await client.close();
    },
  };
}
```

`tests/integration/store.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { mongoCache, type CacheDoc } from '../../src/store/cache.js';
import { hashToken, newReportId, newToken } from '../../src/store/ids.js';
import { hitLimit } from '../../src/store/ratelimits.js';
import { createReport, getReport, setReportFailed, setReportResult } from '../../src/store/reports.js';
import { testDb } from '../helpers/mongo.js';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const now = new Date('2026-10-12T10:00:00Z');

describe('indexes', () => {
  it('creates TTL indexes with the spec retention', async () => {
    const ttl = async (coll: string) =>
      (await db.collection(coll).indexes()).filter((i) => i.expireAfterSeconds !== undefined)
        .map((i) => [Object.keys(i.key)[0], i.expireAfterSeconds]);
    expect(await ttl('reports')).toEqual([['expiresAt', 0]]);
    expect(await ttl('packages')).toEqual([['fetchedAt', 86_400]]);
    expect(await ttl('advisories')).toEqual([['fetchedAt', 604_800]]);
    expect(await ttl('ratelimits')).toEqual([['expiresAt', 0]]);
    expect(await ttl('subscribers')).toEqual([['expiresAt', 0]]);
    expect(await ttl('messages')).toEqual([['createdAt', 15_552_000]]);
  });
});

describe('ids', () => {
  it('generates unguessable ids and tokens', () => {
    expect(newReportId()).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(newReportId()).not.toBe(newReportId());
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('reports', () => {
  it('creates, completes and fails reports', async () => {
    const id = newReportId();
    await createReport(db, { _id: id, projectName: 'x', hasLockfile: false, deps: [], skipped: [] }, now);
    expect(await getReport(db, id)).toMatchObject({ status: 'running', expiresAt: new Date('2026-11-11T10:00:00Z') });
    await setReportResult(db, id, { score: 100 } as never);
    expect((await getReport(db, id))?.status).toBe('done');
    await setReportFailed(db, id, 'timeout');
    expect(await getReport(db, id)).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(await getReport(db, 'nope')).toBeNull();
  });
});

describe('rate limits', () => {
  it('allows exactly `limit` hits per key', async () => {
    const results = await Promise.all(Array.from({ length: 7 }, () => hitLimit(db, 'check:abc:2026-10-12', 5, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect((await hitLimit(db, 'check:other:2026-10-12', 5, now)).allowed).toBe(true);
  });
});

describe('cache', () => {
  it('stores and returns values including null', async () => {
    const cache = mongoCache(db.collection<CacheDoc>('packages'));
    expect(await cache.get('npm:x')).toBeNull();
    await cache.set('dl:x', null);
    expect(await cache.get('dl:x')).toEqual({ value: null });
    await cache.set('npm:x', { a: 1 });
    expect(await cache.get('npm:x')).toEqual({ value: { a: 1 } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/store.test.ts`
Expected: FAIL, because `src/store/db.js` is not found.

- [ ] **Step 3: Implement `src/store/db.ts`**

```ts
import { MongoClient, type Db } from 'mongodb';

const DAY = 86_400;

export async function connect(url: string, dbName: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 20 });
  await client.connect();
  return { client, db: client.db(dbName) };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('reports').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('packages').createIndex({ fetchedAt: 1 }, { expireAfterSeconds: DAY }),
    db.collection('advisories').createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 7 * DAY }),
    db.collection('ratelimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('subscribers').createIndex({ email: 1, list: 1 }, { unique: true }),
    db.collection('subscribers').createIndex({ tokenHash: 1 }),
    db.collection('subscribers').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('messages').createIndex({ createdAt: 1 }, { expireAfterSeconds: 180 * DAY }),
  ]);
}
```

- [ ] **Step 4: Implement `src/store/ids.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newReportId(): string {
  let n = BigInt('0x' + randomBytes(16).toString('hex'));
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const REPORT_ID_RE = /^(?:[0-9A-Za-z]{22}|sample)$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
```

- [ ] **Step 5: Implement `src/store/cache.ts`**

```ts
import type { Collection } from 'mongodb';

export interface CacheStore {
  get<T>(key: string): Promise<{ value: T } | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface CacheDoc {
  _id: string;
  value: unknown;
  fetchedAt: Date;
}

export function mongoCache(coll: Collection<CacheDoc>): CacheStore {
  return {
    async get<T>(key: string) {
      const doc = await coll.findOne({ _id: key });
      return doc ? { value: doc.value as T } : null;
    },
    async set<T>(key: string, value: T) {
      await coll.replaceOne({ _id: key }, { value, fetchedAt: new Date() }, { upsert: true });
    },
  };
}

export function memoryCache(): CacheStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.has(key) ? { value: map.get(key) as T } : null;
    },
    async set<T>(key: string, value: T) {
      map.set(key, value);
    },
  };
}
```

- [ ] **Step 6: Implement `src/store/reports.ts`**

```ts
import type { Db } from 'mongodb';
import type { ReportResult, SkippedDep, StoredDep } from '../analyze/types.js';

export const REPORT_TTL_MS = 30 * 86_400_000;

export interface ReportDoc {
  _id: string;
  status: 'running' | 'done' | 'failed';
  projectName: string;
  hasLockfile: boolean;
  deps: StoredDep[];
  skipped: SkippedDep[];
  result?: ReportResult;
  error?: 'timeout' | 'error' | 'busy';
  createdAt: Date;
  finishedAt?: Date;
  expiresAt?: Date;
}

export type NewReport = Pick<ReportDoc, '_id' | 'projectName' | 'hasLockfile' | 'deps' | 'skipped'>;

const reports = (db: Db) => db.collection<ReportDoc>('reports');

export async function createReport(db: Db, r: NewReport, now: Date): Promise<void> {
  await reports(db).insertOne({ ...r, status: 'running', createdAt: now, expiresAt: new Date(now.getTime() + REPORT_TTL_MS) });
}

export async function upsertSampleReport(db: Db, r: Omit<NewReport, '_id'>, now: Date): Promise<void> {
  await reports(db).replaceOne({ _id: 'sample' }, { ...r, status: 'running', createdAt: now }, { upsert: true });
}

export function getReport(db: Db, id: string): Promise<ReportDoc | null> {
  return reports(db).findOne({ _id: id });
}

export async function setReportResult(db: Db, id: string, result: ReportResult): Promise<void> {
  await reports(db).updateOne({ _id: id }, { $set: { status: 'done', result, finishedAt: new Date() }, $unset: { error: '' } });
}

export async function setReportFailed(db: Db, id: string, error: NonNullable<ReportDoc['error']>): Promise<void> {
  await reports(db).updateOne({ _id: id }, { $set: { status: 'failed', error, finishedAt: new Date() } });
}
```

- [ ] **Step 7: Implement `src/store/ratelimits.ts`**

```ts
import type { Db } from 'mongodb';

const TTL_MS = 48 * 3_600_000;

interface LimitDoc { _id: string; count: number; expiresAt: Date }

export async function hitLimit(db: Db, key: string, limit: number, now: Date, retry = true): Promise<{ allowed: boolean; count: number }> {
  try {
    const doc = await db.collection<LimitDoc>('ratelimits').findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + TTL_MS) } },
      { upsert: true, returnDocument: 'after' },
    );
    const count = doc?.count ?? 1;
    return { allowed: count <= limit, count };
  } catch (e) {
    // Two concurrent first hits can both try to insert the same _id; the loser retries as an update.
    if (retry && (e as { code?: number }).code === 11000) return hitLimit(db, key, limit, now, false);
    throw e;
  }
}

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
```

In driver 7, `findOneAndUpdate` returns the document itself, or `null`. It no longer returns a `{ value }` wrapper.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/store.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/store tests/helpers/mongo.ts tests/integration/store.test.ts
git commit -m "feat(store): MongoDB connection, TTL indexes, reports, cache and rate limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Upstream sources (npm, downloads, OSV, deps.dev) with caching

**Files:**
- Create: `src/sources/http.ts`, `src/sources/limit.ts`, `src/sources/npm.ts`, `src/sources/downloads.ts`, `src/sources/osv.ts`, `src/sources/depsdev.ts`, `src/sources/index.ts`
- Create: `tests/helpers/fakes.ts`
- Test: `tests/unit/sources.test.ts`

**Interfaces:**
- Consumes: `CacheStore`, `memoryCache` (Task 7); `NpmInfo`, `Advisory`, `DepsDevInfo`, `SourceName` (Task 2).
- Produces:
  - `type FetchFn = typeof fetch`; `class UpstreamError`; `type RequestObserver = (source: string, outcome: 'ok' | 'not_found' | 'error', seconds: number) => void`
  - `getJson<T>(fetchFn, url, opts: GetJsonOptions): Promise<T | null>`
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>`
  - `registryPath(name)`, `extractNpm(doc: unknown): NpmInfo`, `fetchNpm(fetchFn, name, opts): Promise<NpmInfo>`
  - `fetchDownloads(fetchFn, names, opts): Promise<{ values: Map<string, number | null>; failed: Set<string> }>`
  - `queryOsv(fetchFn, items, opts): Promise<Map<string, string[]>>` (keyed `name@version`), `extractAdvisory(doc: unknown): Advisory`, `fetchAdvisory(fetchFn, id, opts): Promise<Advisory | null>`
  - `fetchDepsDev(fetchFn, name, version, opts): Promise<DepsDevInfo>`
  - `interface Sources { npmInfos(names, signal?): Promise<{ infos: Map<string, NpmInfo>; unavailable: boolean }>; details(items: DetailItem[], signal?): Promise<Details> }`
  - `interface Details { downloads: Map<string, number | null>; vulns: Map<string, string[] | null>; depsdev: Map<string, DepsDevInfo | null>; advisories: Map<string, Advisory>; unavailable: Set<SourceName> }`
  - `interface SourceMetrics { request: RequestObserver; cache(hit: boolean): void }`
  - `createSources(o: { fetch: FetchFn; cache: CacheStore; advisoryCache: CacheStore; concurrency?: number; timeoutMs?: number; backoffMs?: number; metrics?: SourceMetrics }): Sources`

- [ ] **Step 1: Write the fake fetch helper**

`tests/helpers/fakes.ts`:

```ts
export interface FakeRoute { status?: number; body?: unknown; delayMs?: number }

export function fakeFetch(handler: (url: string, init?: RequestInit) => FakeRoute) {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
    const route = handler(url, init);
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(init.signal?.reason); });
      });
    }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/sources.test.ts`. The fixtures are trimmed copies of real responses, captured on 2026-10-12.

```ts
import { describe, expect, it } from 'vitest';
import { getJson, UpstreamError } from '../../src/sources/http.js';
import { mapLimit } from '../../src/sources/limit.js';
import { extractNpm, registryPath } from '../../src/sources/npm.js';
import { fetchDownloads } from '../../src/sources/downloads.js';
import { extractAdvisory, queryOsv } from '../../src/sources/osv.js';
import { fetchDepsDev } from '../../src/sources/depsdev.js';
import { createSources } from '../../src/sources/index.js';
import { memoryCache } from '../../src/store/cache.js';
import { fakeFetch } from '../helpers/fakes.js';

const fast = { source: 'test', backoffMs: 1 };

describe('getJson', () => {
  it('retries 5xx and 429, then succeeds', () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => (++n < 3 ? { status: n === 1 ? 500 : 429 } : { body: { ok: true } }));
    return getJson(fetch, 'https://x.test/a', fast).then((r) => {
      expect(r).toEqual({ ok: true });
      expect(calls).toHaveLength(3);
    });
  });

  it('returns null for an allowed 404 and throws on other errors', async () => {
    const { fetch } = fakeFetch((u) => ({ status: u.endsWith('404') ? 404 : 400 }));
    expect(await getJson(fetch, 'https://x.test/404', { ...fast, allow404: true })).toBeNull();
    await expect(getJson(fetch, 'https://x.test/400', fast)).rejects.toBeInstanceOf(UpstreamError);
  });

  it('times out slow responses and enforces the size cap', async () => {
    const slow = fakeFetch(() => ({ body: {}, delayMs: 200 }));
    await expect(getJson(slow.fetch, 'https://x.test/slow', { ...fast, timeoutMs: 20, retries: 1 })).rejects.toBeInstanceOf(UpstreamError);
    expect(slow.calls).toHaveLength(2);
    const big = fakeFetch(() => ({ body: { s: 'x'.repeat(2000) } }));
    await expect(getJson(big.fetch, 'https://x.test/big', { ...fast, maxBytes: 1000 })).rejects.toThrow(/too large/);
  });
});

describe('mapLimit', () => {
  it('keeps order and never exceeds the limit', async () => {
    let active = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe('npm', () => {
  it('encodes scoped names', () => {
    expect(registryPath('@fastify/static')).toBe('@fastify%2Fstatic');
    expect(registryPath('lodash')).toBe('lodash');
  });

  it('extracts the fields the rules need', () => {
    const info = extractNpm({
      'dist-tags': { latest: '2.88.2' },
      versions: {
        '2.88.0': { deprecated: 'request has been deprecated, see https://github.com/request/request/issues/3142' },
        '2.88.2': { deprecated: 'request has been deprecated, see https://github.com/request/request/issues/3142' },
        '2.87.0': {},
      },
      time: { created: '2011-01-22T00:00:00Z', modified: '2026-07-17T00:00:00Z', '2.87.0': '2018-05-21T00:00:00Z',
        '2.88.0': '2018-07-17T00:00:00Z', '2.88.2': '2020-02-11T16:47:01Z' },
      maintainers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
    });
    expect(info).toEqual({
      found: true, latest: '2.88.2', distTags: { latest: '2.88.2' }, versions: ['2.88.0', '2.88.2', '2.87.0'],
      lastPublish: '2020-02-11T16:47:01Z', maintainers: 4,
      deprecatedLatest: 'request has been deprecated, see https://github.com/request/request/issues/3142',
      deprecated: {
        '2.88.0': 'request has been deprecated, see https://github.com/request/request/issues/3142',
        '2.88.2': 'request has been deprecated, see https://github.com/request/request/issues/3142',
      },
    });
  });
});

describe('downloads', () => {
  it('handles bulk, single and scoped responses', async () => {
    const { fetch, calls } = fakeFetch((u) => {
      if (u.endsWith('/express,lodash')) return { body: { express: { downloads: 10, package: 'express' }, lodash: null } };
      if (u.endsWith('/%40fastify%2Fstatic')) return { body: { downloads: 5, package: '@fastify/static' } };
      return { status: 500 };
    });
    const r = await fetchDownloads(fetch, ['express', 'lodash', '@fastify/static'], { backoffMs: 1 });
    expect([...r.values]).toEqual([['express', 10], ['lodash', null], ['@fastify/static', 5]]);
    expect(r.failed.size).toBe(0);
    expect(calls.map((c) => c.url)).toContain('https://api.npmjs.org/downloads/point/last-week/express,lodash');
  });
});

describe('osv', () => {
  it('maps batch results by name@version', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: { results: [{ vulns: [{ id: 'GHSA-35jh-r3h4-6jhm', modified: 'x' }] }, {}] } }));
    const r = await queryOsv(fetch, [{ name: 'lodash', version: '4.17.15' }, { name: 'express', version: '5.1.0' }], { backoffMs: 1 });
    expect([...r]).toEqual([['lodash@4.17.15', ['GHSA-35jh-r3h4-6jhm']], ['express@5.1.0', []]]);
    expect(JSON.parse(calls[0]?.body ?? '{}').queries[0]).toEqual({ package: { name: 'lodash', ecosystem: 'npm' }, version: '4.17.15' });
  });

  it('extracts npm SEMVER ranges and severity', () => {
    expect(extractAdvisory({
      id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash',
      database_specific: { severity: 'HIGH' },
      affected: [
        { package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] },
        { package: { name: 'lodash-rails', ecosystem: 'RubyGems' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }] }] },
      ],
    })).toEqual({
      id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
      npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] },
    });
  });
});

describe('deps.dev', () => {
  it('follows the source repo to its scorecard', async () => {
    const { fetch } = fakeFetch((u) => {
      if (u.includes('/packages/express/versions/')) return { body: { relatedProjects: [
        { projectKey: { id: 'github.com/expressjs/express' }, relationType: 'ISSUE_TRACKER' },
        { projectKey: { id: 'github.com/expressjs/express' }, relationType: 'SOURCE_REPO' }] } };
      if (u.endsWith('/projects/github.com%2Fexpressjs%2Fexpress')) return { body: { scorecard: { overallScore: 8.5 }, starsCount: 69553 } };
      return { status: 404 };
    });
    expect(await fetchDepsDev(fetch, 'express', '5.1.0', { backoffMs: 1 })).toEqual({ repo: 'github.com/expressjs/express', scorecard: 8.5, stars: 69553 });
    expect(await fetchDepsDev(fetch, 'unknown', '1.0.0', { backoffMs: 1 })).toEqual({ repo: null, scorecard: null, stars: null });
  });
});

describe('createSources', () => {
  const npmDoc = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} }, time: { '1.0.0': '2026-01-01T00:00:00Z' }, maintainers: [{}] };

  it('caches npm lookups', async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: npmDoc }));
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    await s.npmInfos(['a', 'b']);
    await s.npmInfos(['a', 'b']);
    expect(calls).toHaveLength(2);
  });

  it('reports unavailable sources instead of failing', async () => {
    const { fetch } = fakeFetch((u) => {
      if (u.startsWith('https://api.npmjs.org/')) return { status: 503 };
      if (u.startsWith('https://api.osv.dev/v1/querybatch')) return { body: { results: [{}] } };
      return { status: 404 };
    });
    const s = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    const d = await s.details([{ name: 'a', version: '1.0.0' }]);
    expect([...d.unavailable]).toEqual(['downloads']);
    expect(d.downloads.get('a')).toBeNull();
    expect(d.vulns.get('a@1.0.0')).toEqual([]);
    expect(d.depsdev.get('a@1.0.0')).toEqual({ repo: null, scorecard: null, stars: null });

    const down = fakeFetch(() => ({ status: 500 }));
    const s2 = createSources({ fetch: down.fetch, cache: memoryCache(), advisoryCache: memoryCache(), backoffMs: 1 });
    const r = await s2.npmInfos(['a']);
    expect(r.unavailable).toBe(true);
    expect(r.infos.has('a')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/sources.test.ts`
Expected: FAIL, because the modules are not found.

- [ ] **Step 4: Implement `src/sources/http.ts`**

```ts
export type FetchFn = typeof fetch;
export type RequestObserver = (source: string, outcome: 'ok' | 'not_found' | 'error', seconds: number) => void;

export class UpstreamError extends Error {
  constructor(readonly source: string, readonly status: number | null, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface GetJsonOptions {
  source: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBytes?: number;
  body?: unknown;
  allow404?: boolean;
  observe?: RequestObserver;
}

const USER_AGENT = 'noticely-deps/1.0 (+https://deps.noticely.dev)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(fetchFn: FetchFn, url: string, o: GetJsonOptions): Promise<T | null> {
  const started = performance.now();
  const done = (outcome: 'ok' | 'not_found' | 'error') => o.observe?.(o.source, outcome, (performance.now() - started) / 1000);
  const retries = o.retries ?? 2;
  const backoff = o.backoffMs ?? 200;
  const maxBytes = o.maxBytes ?? 20 * 1024 * 1024;

  for (let attempt = 0; ; attempt++) {
    const signals = [AbortSignal.timeout(o.timeoutMs ?? 5_000)];
    if (o.signal) signals.push(o.signal);
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: o.body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(o.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: AbortSignal.any(signals),
      });
    } catch (e) {
      if (o.signal?.aborted) { done('error'); throw e; }
      if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
      done('error');
      throw new UpstreamError(o.source, null, `${o.source}: ${(e as Error).message}`);
    }
    if (res.status === 404 && o.allow404) { done('not_found'); return null; }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
    if (!res.ok) { done('error'); throw new UpstreamError(o.source, res.status, `${o.source}: HTTP ${res.status}`); }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) { done('error'); throw new UpstreamError(o.source, res.status, `${o.source}: response too large`); }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) { done('error'); throw new UpstreamError(o.source, res.status, `${o.source}: response too large`); }
    done('ok');
    return JSON.parse(Buffer.from(buf).toString('utf8')) as T;
  }
}

export type CallOptions = Omit<GetJsonOptions, 'source' | 'body' | 'allow404'>;
```

- [ ] **Step 5: Implement `src/sources/limit.ts`**

```ts
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

- [ ] **Step 6: Implement `src/sources/npm.ts`**

```ts
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
```

- [ ] **Step 7: Implement `src/sources/downloads.ts`**

```ts
import { getJson, type CallOptions, type FetchFn } from './http.js';

const BASE = 'https://api.npmjs.org/downloads/point/last-week/';
type Point = { downloads?: number } | null;

export async function fetchDownloads(fetchFn: FetchFn, names: string[], o: CallOptions = {}) {
  const values = new Map<string, number | null>();
  const failed = new Set<string>();
  const unscoped = names.filter((n) => !n.startsWith('@'));
  const scoped = names.filter((n) => n.startsWith('@'));
  const chunks: string[][] = [];
  for (let i = 0; i < unscoped.length; i += 128) chunks.push(unscoped.slice(i, i + 128));

  const tasks = [
    ...chunks.map(async (chunk) => {
      try {
        const body = await getJson<Record<string, Point> & Point>(fetchFn, BASE + chunk.map(encodeURIComponent).join(','), { ...o, source: 'downloads', allow404: true });
        for (const n of chunk) {
          const point = chunk.length === 1 ? body : (body as Record<string, Point> | null)?.[n];
          values.set(n, typeof point?.downloads === 'number' ? point.downloads : null);
        }
      } catch (e) {
        if (o.signal?.aborted) throw e;
        for (const n of chunk) { values.set(n, null); failed.add(n); }
      }
    }),
    ...scoped.map(async (n) => {
      try {
        // Scoped names go one per request and fully encoded: @fastify/static -> %40fastify%2Fstatic
        const body = await getJson<Point>(fetchFn, BASE + encodeURIComponent(n), { ...o, source: 'downloads', allow404: true });
        values.set(n, typeof body?.downloads === 'number' ? body.downloads : null);
      } catch (e) {
        if (o.signal?.aborted) throw e;
        values.set(n, null); failed.add(n);
      }
    }),
  ];
  await Promise.all(tasks);
  return { values: new Map(names.map((n) => [n, values.get(n) ?? null])), failed };
}
```

- [ ] **Step 8: Implement `src/sources/osv.ts`**

```ts
import type { Advisory, RangeEvent } from '../analyze/types.js';
import { getJson, type CallOptions, type FetchFn } from './http.js';

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MODERATE', 'LOW']);
export const OSV_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/;

export async function queryOsv(fetchFn: FetchFn, items: Array<{ name: string; version: string }>, o: CallOptions = {}) {
  const out = new Map<string, string[]>();
  for (let i = 0; i < items.length; i += 1000) {
    const chunk = items.slice(i, i + 1000);
    const body = await getJson<{ results?: Array<{ vulns?: Array<{ id?: unknown }> }> }>(fetchFn, 'https://api.osv.dev/v1/querybatch', {
      ...o, source: 'osv',
      body: { queries: chunk.map((it) => ({ package: { name: it.name, ecosystem: 'npm' }, version: it.version })) },
    });
    chunk.forEach((it, idx) => {
      const ids = (body?.results?.[idx]?.vulns ?? []).map((v) => v.id).filter((id): id is string => typeof id === 'string' && OSV_ID_RE.test(id));
      out.set(`${it.name}@${it.version}`, ids);
    });
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
  return {
    id, summary: summary.slice(0, 300),
    severity: typeof sev === 'string' && SEVERITIES.has(sev) ? sev as Advisory['severity'] : null,
    npmRanges,
  };
}

export async function fetchAdvisory(fetchFn: FetchFn, id: string, o: CallOptions = {}): Promise<Advisory | null> {
  if (!OSV_ID_RE.test(id)) return null;
  const doc = await getJson<unknown>(fetchFn, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { ...o, source: 'osv', allow404: true });
  return doc === null ? null : extractAdvisory(doc);
}
```

- [ ] **Step 9: Implement `src/sources/depsdev.ts`**

```ts
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
  if (!repo) return EMPTY;
  const p = await getJson<ProjectDoc>(fetchFn, `https://api.deps.dev/v3/projects/${encodeURIComponent(repo)}`,
    { ...o, source: 'deps.dev', allow404: true });
  return {
    repo,
    scorecard: typeof p?.scorecard?.overallScore === 'number' ? p.scorecard.overallScore : null,
    stars: typeof p?.starsCount === 'number' ? p.starsCount : null,
  };
}
```

- [ ] **Step 10: Implement `src/sources/index.ts`**

```ts
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

export function createSources(o: {
  fetch: FetchFn; cache: CacheStore; advisoryCache: CacheStore;
  concurrency?: number; timeoutMs?: number; backoffMs?: number; metrics?: SourceMetrics;
}): Sources {
  const conc = o.concurrency ?? 8;
  const call = (signal?: AbortSignal): CallOptions => ({ signal, timeoutMs: o.timeoutMs, backoffMs: o.backoffMs, observe: o.metrics?.request });

  async function cached<T>(store: CacheStore, key: string, load: () => Promise<T>): Promise<T> {
    const hit = await store.get<T>(key);
    o.metrics?.cache(hit !== null);
    if (hit) return hit.value;
    const value = await load();
    await store.set(key, value);
    return value;
  }

  return {
    async npmInfos(names, signal) {
      const infos = new Map<string, NpmInfo>();
      let unavailable = false;
      await mapLimit(names, conc, async (name) => {
        try {
          infos.set(name, await cached(o.cache, `npm:${name}`, () => fetchNpm(o.fetch, name, call(signal))));
        } catch (e) {
          if (signal?.aborted) throw e;
          unavailable = true;
        }
      });
      return { infos, unavailable };
    },

    async details(items, signal) {
      const unavailable = new Set<SourceName>();
      const key = (it: DetailItem) => `${it.name}@${it.version}`;

      const downloadsTask = (async () => {
        const out = new Map<string, number | null>();
        const missing: string[] = [];
        for (const name of new Set(items.map((i) => i.name))) {
          const hit = await o.cache.get<number | null>(`dl:${name}`);
          o.metrics?.cache(hit !== null);
          if (hit) out.set(name, hit.value); else missing.push(name);
        }
        if (missing.length) {
          const r = await fetchDownloads(o.fetch, missing, call(signal));
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
        await mapLimit(items, conc, async (it) => {
          try {
            out.set(key(it), await cached(o.cache, `dd:${key(it)}`, () => fetchDepsDev(o.fetch, it.name, it.version, call(signal))));
          } catch (e) {
            if (signal?.aborted) throw e;
            unavailable.add('deps.dev');
            out.set(key(it), null);
          }
        });
        return out;
      })();

      const [downloads, vulns, depsdev] = await Promise.all([downloadsTask, vulnsTask, depsdevTask]);

      const advisories = new Map<string, Advisory>();
      const ids = [...new Set([...vulns.values()].flatMap((v) => v ?? []))];
      await mapLimit(ids, conc, async (id) => {
        try {
          const adv = await cached(o.advisoryCache, `adv:${id}`, () => fetchAdvisory(o.fetch, id, call(signal)));
          if (adv) advisories.set(id, adv);
        } catch (e) {
          if (signal?.aborted) throw e;
          unavailable.add('osv');
        }
      });
      return { downloads, vulns, depsdev, advisories, unavailable };
    },
  };
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/sources.test.ts`
Expected: PASS. If the timeout test takes longer than 2 s, reduce `delayMs`. It must only exceed `timeoutMs`.

- [ ] **Step 12: Commit**

```bash
git add src/sources tests/helpers/fakes.ts tests/unit/sources.test.ts
git commit -m "feat(sources): npm, downloads, OSV and deps.dev clients with retries, size caps and caching

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Check pipeline (analysis orchestration and bounded runner)

**Files:**
- Create: `src/check/analyze-deps.ts`, `src/check/runner.ts`
- Test: `tests/unit/analyze-deps.test.ts`, `tests/integration/runner.test.ts`

**Interfaces:**
- Consumes:
  - `Sources` and `Details` (Task 8);
  - `resolveDep` (Task 3), `evaluatePackage` (Task 4), `computeScore`/`computeCounts`/`buildPlan` (Task 5), `buildSummary` (Task 6);
  - the report repository functions (Task 7).
- Produces:
  - `analyzeDeps(input: { deps: StoredDep[] }, sources: Sources, replacements: Record<string, Replacement>, now: Date, signal?: AbortSignal): Promise<ReportResult>`
  - `interface CheckMetrics { finished(result: 'done' | 'failed' | 'timeout', seconds: number): void }`
  - `class CheckRunner { constructor(o: RunnerOptions); submit(reportId: string): boolean; idle(): Promise<void>; readonly active: number; readonly queued: number }`
  - `interface RunnerOptions { db: Db; sources: Sources; replacements: Record<string, Replacement>; clock?: () => Date; timeoutMs?: number; concurrency?: number; queueLimit?: number; metrics?: CheckMetrics; log?: (msg: string, err?: unknown) => void }`
- Also add to `tests/helpers/fakes.ts`: `fakeSources(o?: Partial<FakeSourceData>): Sources`.

- [ ] **Step 1: Add the fake sources helper**

Append to `tests/helpers/fakes.ts`:

```ts
import type { Advisory, DepsDevInfo, NpmInfo, SourceName } from '../../src/analyze/types.js';
import type { Sources } from '../../src/sources/index.js';

export interface FakeSourceData {
  npm: Record<string, NpmInfo>;
  vulns: Record<string, string[]>;
  advisories: Record<string, Advisory>;
  unavailable: SourceName[];
  npmUnavailable: boolean;
  delayMs: number;
}

export const npmInfo = (o: Partial<NpmInfo> = {}): NpmInfo => ({
  found: true, latest: '1.0.0', distTags: { latest: '1.0.0' }, versions: ['1.0.0'], lastPublish: '2026-06-01T00:00:00Z',
  maintainers: 3, deprecatedLatest: null, deprecated: {}, ...o,
});

export function fakeSources(o: Partial<FakeSourceData> = {}): Sources {
  const d: FakeSourceData = { npm: {}, vulns: {}, advisories: {}, unavailable: [], npmUnavailable: false, delayMs: 0, ...o };
  const wait = async (signal?: AbortSignal) => {
    if (!d.delayMs) return;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, d.delayMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason); });
    });
  };
  return {
    async npmInfos(names, signal) {
      await wait(signal);
      const infos = new Map<string, NpmInfo>();
      for (const n of names) if (d.npm[n]) infos.set(n, d.npm[n]);
      return { infos, unavailable: d.npmUnavailable };
    },
    async details(items) {
      const dd: DepsDevInfo = { repo: null, scorecard: 7, stars: 100 };
      const unavailable = new Set(d.unavailable);
      return {
        downloads: new Map(items.map((i) => [i.name, unavailable.has('downloads') ? null : 1000])),
        vulns: new Map(items.map((i) => [`${i.name}@${i.version}`, unavailable.has('osv') ? null : d.vulns[`${i.name}@${i.version}`] ?? []])),
        depsdev: new Map(items.map((i) => [`${i.name}@${i.version}`, unavailable.has('deps.dev') ? null : dd])),
        advisories: new Map(Object.entries(d.advisories)),
        unavailable,
      };
    },
  };
}
```

Move the existing `fakeFetch` exports below these imports, so that all imports sit at the top of the file.

- [ ] **Step 2: Write the failing unit test for `analyzeDeps`**

`tests/unit/analyze-deps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzeDeps } from '../../src/check/analyze-deps.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';

const now = new Date('2026-10-12T00:00:00Z');

describe('analyzeDeps', () => {
  it('produces a complete result', async () => {
    const sources = fakeSources({
      npm: {
        lodash: npmInfo({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }),
        express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }),
      },
      vulns: { 'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'] },
      advisories: { 'GHSA-35jh-r3h4-6jhm': { id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
        npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] } } },
    });
    const r = await analyzeDeps({ deps: [
      { name: 'express', spec: '^5.1.0', scope: 'prod', lockVersion: null },
      { name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null },
      { name: '@acme/private', spec: '^1.0.0', scope: 'prod', lockVersion: null },
    ] }, sources, {}, now);
    expect(r.score).toBe(88);
    expect(r.label).toBe('Healthy');
    expect(r.packages.map((p) => [p.name, p.status, p.risk])).toEqual([
      ['express', 'checked', 'healthy'], ['lodash', 'checked', 'high'], ['@acme/private', 'not-found', 'healthy'],
    ]);
    expect(r.plan.steps[0]?.action).toBe('Upgrade to 4.17.21');
    expect(r.summary).toBe('1 known vulnerability with available fixes. Working through the upgrade plan takes an estimated 15 min.');
    expect(r.partial).toEqual([]);
  });

  it('handles an empty dependency list', async () => {
    const r = await analyzeDeps({ deps: [] }, fakeSources(), {}, now);
    expect(r).toMatchObject({ score: 100, label: 'Healthy', summary: 'No dependencies to check.', packages: [] });
  });

  it('marks partial data when a source is unavailable', async () => {
    const r = await analyzeDeps({ deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] },
      fakeSources({ npm: { a: npmInfo() }, unavailable: ['osv'] }), {}, now);
    expect(r.partial).toEqual(['osv']);
    expect(r.packages[0]?.status).toBe('checked');
  });

  it('marks npm as partial when the registry is down', async () => {
    const r = await analyzeDeps({ deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] },
      fakeSources({ npmUnavailable: true }), {}, now);
    expect(r.partial).toEqual(['npm']);
    expect(r.packages[0]).toMatchObject({ status: 'unresolved', resolution: 'unavailable' });
  });
});
```

Score check: lodash is High (−12), so 100 − 12 = 88, which is Healthy.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/analyze-deps.test.ts`
Expected: FAIL, because the module is not found.

- [ ] **Step 4: Implement `src/check/analyze-deps.ts`**

```ts
import { buildPlan } from '../analyze/plan.js';
import { resolveDep } from '../analyze/resolve.js';
import { evaluatePackage } from '../analyze/rules.js';
import { computeCounts, computeScore } from '../analyze/score.js';
import { buildSummary } from '../analyze/summary.js';
import type { PackageData, Replacement, ReportResult, SourceName, StoredDep } from '../analyze/types.js';
import type { Sources } from '../sources/index.js';

export async function analyzeDeps(
  input: { deps: StoredDep[] }, sources: Sources, replacements: Record<string, Replacement>, now: Date, signal?: AbortSignal,
): Promise<ReportResult> {
  const names = [...new Set(input.deps.map((d) => d.name))];
  const { infos, unavailable: npmDown } = await sources.npmInfos(names, signal);
  const resolved = input.deps.map((d) => resolveDep(d, infos.get(d.name), npmDown));

  const items = resolved.filter((r) => r.resolved !== null).map((r) => ({ name: r.name, version: r.resolved as string }));
  const details = await sources.details(items, signal);

  const packages = resolved.map((r) => {
    const key = `${r.name}@${r.resolved}`;
    const data: PackageData = {
      npm: infos.get(r.name),
      downloads: details.downloads.get(r.name) ?? null,
      depsdev: details.depsdev.get(key) ?? null,
      vulnIds: details.vulns.has(key) ? details.vulns.get(key) ?? null : null,
    };
    return evaluatePackage(r, data, details.advisories, now);
  });

  const { score, label } = computeScore(packages);
  const counts = computeCounts(packages);
  const plan = buildPlan(packages, replacements);
  const allVulnsFixable = packages.every((p) => p.vulns.every((v) => v.fixedIn !== null));
  const partial: SourceName[] = [];
  if (npmDown) partial.push('npm');
  for (const s of ['downloads', 'osv', 'deps.dev'] as const) if (details.unavailable.has(s)) partial.push(s);

  return { score, label, summary: buildSummary(counts, plan, allVulnsFixable), counts, packages, plan, partial };
}
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx vitest run tests/unit/analyze-deps.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing runner integration test**

`tests/integration/runner.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { CheckRunner } from '../../src/check/runner.js';
import { newReportId } from '../../src/store/ids.js';
import { createReport, getReport } from '../../src/store/reports.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';
import { testDb } from '../helpers/mongo.js';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

async function newReport() {
  const id = newReportId();
  await createReport(db, { _id: id, projectName: 'p', hasLockfile: false, skipped: [],
    deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] }, new Date());
  return id;
}

describe('CheckRunner', () => {
  it('runs a check to completion', async () => {
    const finished: string[] = [];
    const runner = new CheckRunner({ db, sources: fakeSources({ npm: { a: npmInfo() } }), replacements: {},
      metrics: { finished: (r) => finished.push(r) } });
    const id = await newReport();
    expect(runner.submit(id)).toBe(true);
    await runner.idle();
    expect(await getReport(db, id)).toMatchObject({ status: 'done', result: { score: 100 } });
    expect(finished).toEqual(['done']);
  });

  it('fails a check that exceeds the timeout', async () => {
    const runner = new CheckRunner({ db, sources: fakeSources({ npm: { a: npmInfo() }, delayMs: 200 }), replacements: {}, timeoutMs: 30 });
    const id = await newReport();
    runner.submit(id);
    await runner.idle();
    expect(await getReport(db, id)).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('refuses work beyond concurrency + queue limit', async () => {
    const runner = new CheckRunner({ db, sources: fakeSources({ delayMs: 100 }), replacements: {}, concurrency: 1, queueLimit: 1 });
    const ids = [await newReport(), await newReport(), await newReport()];
    expect(ids.map((id) => runner.submit(id))).toEqual([true, true, false]);
    await runner.idle();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/runner.test.ts`
Expected: FAIL, because `runner.js` is not found.

- [ ] **Step 8: Implement `src/check/runner.ts`**

```ts
import type { Db } from 'mongodb';
import type { Replacement } from '../analyze/types.js';
import type { Sources } from '../sources/index.js';
import { getReport, setReportFailed, setReportResult } from '../store/reports.js';
import { analyzeDeps } from './analyze-deps.js';

export interface CheckMetrics { finished(result: 'done' | 'failed' | 'timeout', seconds: number): void }

export interface RunnerOptions {
  db: Db;
  sources: Sources;
  replacements: Record<string, Replacement>;
  clock?: () => Date;
  timeoutMs?: number;
  concurrency?: number;
  queueLimit?: number;
  metrics?: CheckMetrics;
  log?: (msg: string, err?: unknown) => void;
}

export class CheckRunner {
  private readonly queue: string[] = [];
  private running = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly o: RunnerOptions) {}

  get active(): number { return this.running; }
  get queued(): number { return this.queue.length; }

  submit(reportId: string): boolean {
    const concurrency = this.o.concurrency ?? 4;
    if (this.running >= concurrency && this.queue.length >= (this.o.queueLimit ?? 20)) return false;
    this.queue.push(reportId);
    this.pump();
    return true;
  }

  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    const concurrency = this.o.concurrency ?? 4;
    while (this.running < concurrency && this.queue.length > 0) {
      const id = this.queue.shift() as string;
      this.running++;
      void this.run(id).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          const w = this.waiters;
          this.waiters = [];
          w.forEach((fn) => fn());
        }
      });
    }
  }

  private async run(id: string): Promise<void> {
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    const signal = AbortSignal.timeout(this.o.timeoutMs ?? 30_000);
    try {
      const doc = await getReport(this.o.db, id);
      if (!doc || doc.status !== 'running') return;
      const result = await analyzeDeps(doc, this.o.sources, this.o.replacements, (this.o.clock ?? (() => new Date()))(), signal);
      if (signal.aborted) throw signal.reason;
      await setReportResult(this.o.db, id, result);
      this.o.metrics?.finished('done', seconds());
    } catch (err) {
      const timedOut = signal.aborted;
      this.o.log?.(`check ${id} ${timedOut ? 'timed out' : 'failed'}`, err);
      await setReportFailed(this.o.db, id, timedOut ? 'timeout' : 'error').catch(() => undefined);
      this.o.metrics?.finished(timedOut ? 'timeout' : 'failed', seconds());
    }
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/runner.test.ts tests/unit/analyze-deps.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/check tests
git commit -m "feat(check): analysis orchestration and bounded runner with timeout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Web foundation (app factory, security headers, layout, static pages, assets)

**Files:**
- Create: `src/web/app.ts`, `src/web/views.ts`, `src/web/turnstile.ts`, `src/web/routes/pages.ts`, `src/mail/mailer.ts`
- Create: `views/layout.eta`, `views/home.eta`, `views/notice.eta`, `views/methodology.eta`, `views/privacy.eta`, `views/partials/notify-form.eta`
- Create: `public/app.css`, `public/app.js`, `public/brand/*` (copied)
- Create: `tests/helpers/app.ts`
- Test: `tests/integration/web-pages.test.ts`, `tests/unit/turnstile.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1), `CheckRunner` (Task 9), `InputError` (Task 2), `FetchFn` (Task 8).
- Produces:
  - `interface MailMessage { to: string; subject: string; text: string; replyTo?: string }`, `interface Mailer { send(m: MailMessage): Promise<void> }`, `createLogMailer(log: (line: string) => void): Mailer`
  - `interface Turnstile { verify(token: string | undefined, ip: string): Promise<boolean> }`, `createTurnstile(o: { secret: string; fetch: FetchFn }): Turnstile`
  - `interface AppMetrics { limited(kind: 'check' | 'global' | 'contact' | 'notify'): void; confirmed(list: 'pdf' | 'pack'): void; render(): Promise<string> }`
  - `interface AppDeps { config: Config; db: Db; runner: CheckRunner; mailer: Mailer; turnstile: Turnstile; clock?: () => Date; metrics?: AppMetrics; logger?: boolean }`
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>`
  - Fastify reply decorator `reply.page(template: string, data?: Record<string, unknown>, status?: number)`, plus the route-plugin convention `export default async function routes(app: FastifyInstance, deps: AppDeps)`
- Template data available in every view: `it.siteKey`, `it.publicUrl`, `it.title`, `it.turnstile`, `it.refresh`

- [ ] **Step 1: Copy the brand assets**

```bash
mkdir -p public/brand
cp ~/noticely/brand/{favicon.ico,favicon.svg,apple-touch-icon.png,icon-192.png,noticely-mark.svg,noticely-wordmark-dark.png,noticely-wordmark-light.png} public/brand/
```

- [ ] **Step 2: Implement `src/mail/mailer.ts` (interface + log mailer) and `src/web/turnstile.ts`**

`src/mail/mailer.ts`:

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  send(m: MailMessage): Promise<void>;
}

/** Development mailer: writes the email to the log instead of sending it. */
export function createLogMailer(log: (line: string) => void): Mailer {
  return {
    async send(m) {
      log(`[mail] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    },
  };
}
```

`src/web/turnstile.ts`:

```ts
import type { FetchFn } from '../sources/http.js';

export interface Turnstile {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

export function createTurnstile(o: { secret: string; fetch: FetchFn }): Turnstile {
  return {
    async verify(token, ip) {
      if (!token || token.length > 2048) return false;
      try {
        const res = await o.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: o.secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { success?: unknown };
        return body.success === true;
      } catch {
        return false;
      }
    },
  };
}
```

`tests/unit/turnstile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTurnstile } from '../../src/web/turnstile.js';
import { fakeFetch } from '../helpers/fakes.js';

describe('turnstile', () => {
  it('accepts only success:true and sends secret, token and IP', async () => {
    const ok = fakeFetch(() => ({ body: { success: true } }));
    expect(await createTurnstile({ secret: 's', fetch: ok.fetch }).verify('tok', '1.2.3.4')).toBe(true);
    expect(JSON.parse(ok.calls[0]?.body ?? '{}')).toEqual({ secret: 's', response: 'tok', remoteip: '1.2.3.4' });
    const no = fakeFetch(() => ({ body: { success: false } }));
    expect(await createTurnstile({ secret: 's', fetch: no.fetch }).verify('tok', '1.2.3.4')).toBe(false);
    const down = fakeFetch(() => ({ status: 500 }));
    expect(await createTurnstile({ secret: 's', fetch: down.fetch }).verify('tok', '1.2.3.4')).toBe(false);
    expect(await createTurnstile({ secret: 's', fetch: ok.fetch }).verify(undefined, '1.2.3.4')).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/turnstile.test.ts`. Expected: PASS once the file exists. Run it once before creating `turnstile.ts` to see it FAIL.

- [ ] **Step 3: Write the failing page tests and the app test helper**

`tests/helpers/app.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { CheckRunner } from '../../src/check/runner.js';
import { loadConfig, type Config } from '../../src/config.js';
import type { MailMessage } from '../../src/mail/mailer.js';
import type { Sources } from '../../src/sources/index.js';
import { buildApp, type AppMetrics } from '../../src/web/app.js';
import { fakeSources } from './fakes.js';
import { testDb } from './mongo.js';

export async function testApp(o: { sources?: Sources; config?: Partial<Config>; turnstileOk?: boolean; now?: Date } = {}) {
  const { db, close } = await testDb();
  const config = { ...loadConfig({ NODE_ENV: 'test' }), CONTACT_TO: 'owner@example.com', ...o.config };
  const runner = new CheckRunner({ db, sources: o.sources ?? fakeSources(), replacements: {} });
  const mails: MailMessage[] = [];
  const events: string[] = [];
  const metrics: AppMetrics = {
    limited: (k) => events.push(`limited:${k}`),
    confirmed: (l) => events.push(`confirmed:${l}`),
    render: async () => '# metrics\ndeps_checks_total 0\n',
  };
  let turnstileOk = o.turnstileOk ?? true;
  const app: FastifyInstance = await buildApp({
    config, db, runner, metrics,
    mailer: { send: async (m) => { mails.push(m); } },
    turnstile: { verify: async () => turnstileOk },
    clock: o.now ? () => o.now as Date : undefined,
  });
  return {
    app, db, runner, mails, events,
    setTurnstile(v: boolean) { turnstileOk = v; },
    async close() { await app.close(); await close(); },
  };
}
```

`tests/integration/web-pages.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../helpers/app.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

describe('pages', () => {
  it('serves the home page with the check form and strict headers', async () => {
    const res = await t.app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('action="/check"');
    expect(res.body).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(res.headers['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).not.toMatch(/<script>(?!<\/script>)/); // no inline scripts
    expect(res.body).not.toMatch(/\sstyle="/);
  });

  it('explains the methodology with the real numbers', async () => {
    const res = await t.app.inject({ url: '/methodology' });
    expect(res.statusCode).toBe(200);
    for (const s of ['−25', '−12', '−5', '−1', '85–100', '2 years', '15 min']) expect(res.body).toContain(s);
  });

  it('serves privacy, static files and favicons', async () => {
    expect((await t.app.inject({ url: '/privacy' })).body).toContain('30 days');
    expect((await t.app.inject({ url: '/static/app.css' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.ico' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.svg' })).statusCode).toBe(200);
  });

  it('renders a friendly 404', async () => {
    const res = await t.app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Page not found');
  });

  it('never shows the owner name', async () => {
    for (const url of ['/', '/methodology', '/privacy']) {
      expect((await t.app.inject({ url })).body).not.toMatch(OWNER_NAME_RE);
    }
  });
});
```

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/web-pages.test.ts`
Expected: FAIL, because `src/web/app.js` is not found.

- [ ] **Step 4: Implement `src/web/views.ts`**

```ts
import path from 'node:path';
import { Eta } from 'eta';

export function createViews(production: boolean): Eta {
  return new Eta({ views: path.resolve('views'), autoEscape: true, cache: production });
}
```

- [ ] **Step 5: Implement `src/web/app.ts`**

```ts
import path from 'node:path';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Db } from 'mongodb';
import { InputError, LIMITS } from '../analyze/parse.js';
import type { CheckRunner } from '../check/runner.js';
import type { Config } from '../config.js';
import type { Mailer } from '../mail/mailer.js';
import pages from './routes/pages.js';
import type { Turnstile } from './turnstile.js';
import { createViews } from './views.js';

export interface AppMetrics {
  limited(kind: 'check' | 'global' | 'contact' | 'notify'): void;
  confirmed(list: 'pdf' | 'pack'): void;
  render(): Promise<string>;
}

export interface AppDeps {
  config: Config;
  db: Db;
  runner: CheckRunner;
  mailer: Mailer;
  turnstile: Turnstile;
  clock?: () => Date;
  metrics?: AppMetrics;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyReply {
    page(template: string, data?: Record<string, unknown>, status?: number): FastifyReply;
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const noopMetrics: AppMetrics = { limited() {}, confirmed() {}, render: async () => '' };

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ? {
      level: 'info',
      // Never log tokens, file contents, emails or raw client IPs (spec §7).
      serializers: {
        req: (req) => ({ method: req.method, url: req.url.replace(/\/(confirm|unsubscribe)\/[^/?]+/, '/$1/[token]') }),
      },
    } : false,
    bodyLimit: 11 * 1024 * 1024,
    disableRequestLogging: false,
  });
  const views = createViews(deps.config.NODE_ENV === 'production');
  const common = { siteKey: deps.config.TURNSTILE_SITE_KEY, publicUrl: deps.config.PUBLIC_URL, title: '', turnstile: false, refresh: 0 };

  app.decorateReply('page', function (this: FastifyReply, template: string, data: Record<string, unknown> = {}, status = 200) {
    const html = views.render(template, { ...common, ...data });
    return this.code(status).type('text/html; charset=utf-8').send(html);
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    return payload;
  });

  await app.register(formbody, { bodyLimit: 64 * 1024 });
  await app.register(multipart, {
    attachFieldsToBody: 'keyValues',
    throwFileSizeLimit: true,
    limits: { fileSize: LIMITS.lockfileBytes, files: 2, fields: 5, fieldSize: LIMITS.packageJsonBytes + 1024, parts: 8 },
  });
  await app.register(fastifyStatic, { root: path.resolve('public'), prefix: '/static/', maxAge: '1d' });

  for (const [route, file] of [['/favicon.ico', 'favicon.ico'], ['/favicon.svg', 'favicon.svg'], ['/apple-touch-icon.png', 'apple-touch-icon.png']] as const) {
    app.get(route, (_req, reply) => reply.sendFile(`brand/${file}`));
  }

  app.setNotFoundHandler((_req, reply) =>
    reply.page('./notice', { title: 'Page not found', heading: 'Page not found', message: 'This page does not exist, or the report has expired (reports are kept for 30 days).' }, 404));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof InputError) {
      return reply.page('./notice', { title: 'Check failed', heading: "That file couldn't be checked", message: err.userMessage, back: true }, 400);
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 413 || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.page('./notice', { title: 'File too large', heading: 'File too large', message: 'package.json can be up to 256 KB and the lockfile up to 10 MB.', back: true }, 413);
    }
    if (status >= 400 && status < 500) {
      return reply.page('./notice', { title: 'Bad request', heading: 'Something was wrong with that request', message: 'Please go back and try again.', back: true }, status);
    }
    req.log.error(err);
    return reply.page('./notice', { title: 'Error', heading: 'Something went wrong', message: 'Please try again in a minute.' }, 500);
  });

  await app.register(pages, deps);
  return app;
}
```

- [ ] **Step 6: Implement `src/web/routes/pages.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

export default async function pages(app: FastifyInstance, _deps: AppDeps): Promise<void> {
  app.get('/', (_req, reply) => reply.page('./home', { turnstile: true }));
  app.get('/methodology', (_req, reply) => reply.page('./methodology', { title: 'Methodology' }));
  app.get('/privacy', (_req, reply) => reply.page('./privacy', { title: 'Privacy' }));
}
```

- [ ] **Step 7: Create the templates**

`views/layout.eta`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><%= it.title ? it.title + ' · noticely/deps' : 'noticely/deps · dependency health check for npm projects' %></title>
<meta name="description" content="Check a package.json for vulnerable, deprecated and abandoned dependencies. Free report with a prioritised upgrade plan.">
<% if (it.refresh) { %><meta http-equiv="refresh" content="<%= it.refresh %>"><% } %>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/static/app.css">
<script src="/static/app.js" defer></script>
<% if (it.turnstile) { %><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><% } %>
</head>
<body>
<header class="nav">
  <a class="logo" href="/"><img src="/static/brand/noticely-mark.svg" alt="" width="26" height="26"><span>noticely<b>/deps</b></span></a>
  <nav>
    <a href="/">New check</a>
    <a href="/methodology">Methodology</a>
    <a href="https://github.com/noticely-dev/deps" rel="noopener">GitHub ↗</a>
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch light/dark theme">◐</button>
  </nav>
</header>
<main class="wrap"><%~ it.body %></main>
<footer class="foot">
  <span>Data: npm registry · OSV.dev · deps.dev / OpenSSF Scorecard</span>
  <a href="/privacy">Privacy</a>
  <span>Reports are deleted after 30 days</span>
  <span>Open source · MIT</span>
</footer>
</body>
</html>
```

`views/home.eta`:

```html
<% layout('./layout') %>
<section class="hero">
  <h1>Is your Node.js project aging badly?</h1>
  <p class="lede">Paste or upload your <code>package.json</code> and see which dependencies are <b>vulnerable</b>, <b>deprecated</b>, <b>abandoned</b> or far behind, with a prioritised upgrade plan and effort estimates.</p>
</section>
<form class="panel check-form" method="post" action="/check" enctype="multipart/form-data" data-dropzone>
  <label for="packageJson" class="label">package.json</label>
  <textarea id="packageJson" name="packageJson" rows="12" spellcheck="false" placeholder='{ "dependencies": { "express": "^5.1.0" } }'></textarea>
  <div class="files">
    <label>…or upload <code>package.json</code> <input type="file" name="packageJsonFile" accept=".json,application/json"></label>
    <label><code>package-lock.json</code> <span class="muted">optional, gives exact versions</span> <input type="file" name="lockfile" accept=".json,application/json"></label>
  </div>
  <div class="cf-turnstile" data-sitekey="<%= it.siteKey %>"></div>
  <div class="row-actions">
    <button class="b p" type="submit">Check dependencies</button>
    <a href="/sample">See a sample report →</a>
  </div>
  <p class="muted small">5 free checks per day. Only dependency names and versions are stored, for 30 days. Private <code>@scope/…</code> packages are listed but never looked up anywhere except the public npm registry.</p>
</form>
<section class="how">
  <div class="panel"><b>1 · Paste</b><p class="muted">Your <code>package.json</code>, plus the lockfile if you want exact versions.</p></div>
  <div class="panel"><b>2 · Check</b><p class="muted">Each package is checked against npm, OSV.dev and deps.dev for vulnerabilities, deprecation and maintenance.</p></div>
  <div class="panel"><b>3 · Fix</b><p class="muted">Get a health score, a plain-English summary and an upgrade plan ordered by risk removed per hour.</p></div>
</section>
```

`views/notice.eta`:

```html
<% layout('./layout', { turnstile: !!it.notifyList }) %>
<section class="panel notice">
  <h1><%= it.heading %></h1>
  <p><%= it.message %></p>
  <% if (it.notifyList) { %><%~ include('./partials/notify-form', { list: it.notifyList, reportId: it.reportId || '' }) %><% } %>
  <p class="row-actions">
    <% if (it.back) { %><a class="b" href="/">← New check</a><% } %>
    <% if (it.link) { %><a class="b p" href="<%= it.link.href %>"><%= it.link.label %></a><% } %>
  </p>
</section>
```

`views/partials/notify-form.eta`:

```html
<form class="notify" method="post" action="/notify">
  <input type="hidden" name="list" value="<%= it.list %>">
  <input type="hidden" name="r" value="<%= it.reportId %>">
  <label class="sr-only" for="notify-email-<%= it.list %>">Email</label>
  <div class="in">
    <input id="notify-email-<%= it.list %>" type="email" name="email" required maxlength="254" placeholder="you@company.com" autocomplete="email">
    <button class="b" type="submit">Notify me</button>
  </div>
  <div class="cf-turnstile" data-sitekey="<%= it.siteKey %>" data-size="flexible"></div>
  <p class="muted small">One email when it's available, with a confirmation link first. Unsubscribe any time.</p>
</form>
```

`views/methodology.eta`:

```html
<% layout('./layout') %>
<article class="panel prose">
<h1>Methodology</h1>
<p>Every number on a report comes from the rules below. They are deliberately simple, so you can check them.</p>
<h2>Versions</h2>
<p>With a <code>package-lock.json</code>, the exact installed version is checked. Without one, the <b>lowest</b> published version your range allows is checked (worst case), and findings are marked “may already be fixed”.</p>
<h2>Findings</h2>
<table>
<tr><th>Finding</th><th>Risk</th></tr>
<tr><td>Known vulnerability (OSV.dev)</td><td>The advisory's own severity: Critical, High, Medium (moderate) or Low</td></tr>
<tr><td>Package deprecated by its authors</td><td>High</td></tr>
<tr><td>Only the version you use is deprecated</td><td>Medium</td></tr>
<tr><td>No release for more than 2 years</td><td>Medium</td></tr>
<tr><td>Single npm maintainer</td><td>Low (Medium if also idle for 2 years)</td></tr>
<tr><td>1–2 major versions behind / 3 or more</td><td>Low / Medium</td></tr>
</table>
<p>A package's risk is its worst finding.</p>
<h2>Health score</h2>
<p>Start at 100 and subtract per package: Critical −25, High −12, Medium −5, Low −1. devDependencies count half. The score never goes below 0. <b>85–100</b> Healthy, <b>60–84</b> Needs attention, <b>below 60</b> At risk.</p>
<h2>Upgrade plan and estimates</h2>
<p>Steps are ordered by risk removed per hour of work. Estimates are rough ranges: patch or minor upgrade ~15 min, renamed package ~30 min, major upgrade 0.5–1 day plus 0.5 day per extra major, replacing a deprecated package 0.5–1 day. Low-risk maintenance findings are listed as “keep an eye on it”, with no estimate.</p>
<h2>Data sources</h2>
<p>npm registry (versions, deprecation, maintainers, release dates), npm download counts, OSV.dev (vulnerabilities), deps.dev (source repository and OpenSSF Scorecard). Data is cached for 24 hours.</p>
</article>
```

`views/privacy.eta`:

```html
<% layout('./layout') %>
<article class="panel prose">
<h1>Privacy</h1>
<ul>
<li><b>What is stored:</b> only the dependency names, version ranges and resolved versions from your file, and the resulting report. Never the whole file, scripts or other fields.</li>
<li><b>How long:</b> reports are deleted automatically after 30 days.</li>
<li><b>Who sees it:</b> anyone with the report link (it contains a long random id). Package names are sent to the public npm registry, OSV.dev and deps.dev to look them up.</li>
<li><b>Your IP address:</b> stored only as a keyed hash, for the daily check limit, and deleted after 48 hours.</li>
<li><b>Emails:</b> if you ask to be notified, your address is stored only after you click the confirmation link, and only for that purpose. Every email has an unsubscribe link.</li>
<li><b>Contact form:</b> messages are kept for up to 180 days.</li>
<li><b>Bot protection:</b> Cloudflare Turnstile runs on the forms.</li>
</ul>
<p>To have data deleted earlier, use the <a href="/contact">contact form</a>.</p>
</article>
```

- [ ] **Step 8: Create `public/app.css`**

```css
:root {
  --bg: #0b0d12; --panel: #12151c; --panel2: #171b24; --line: #232838; --fg: #e6e8ee; --mut: #8b93a7; --acc: #3b82f6;
  --crit-bg: rgba(240,68,56,.14); --crit: #fda29b; --high-bg: rgba(247,144,9,.14); --high: #fdb022;
  --med-bg: rgba(250,204,21,.11); --med: #fde68a; --low-bg: rgba(148,163,184,.14); --low: #cbd5e1;
  --ok-bg: rgba(34,197,94,.12); --ok: #86efac; --ring-track: #232838;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #f8f9fb; --panel: #ffffff; --panel2: #fcfcfd; --line: #eaecf0; --fg: #101828; --mut: #667085; --acc: #2563eb;
    --crit-bg: #fef3f2; --crit: #b42318; --high-bg: #fff4ed; --high: #c4320a; --med-bg: #fffaeb; --med: #b54708;
    --low-bg: #f2f4f7; --low: #475467; --ok-bg: #ecfdf3; --ok: #067647; --ring-track: #eaecf0; color-scheme: light;
  }
}
:root[data-theme="light"] {
  --bg: #f8f9fb; --panel: #ffffff; --panel2: #fcfcfd; --line: #eaecf0; --fg: #101828; --mut: #667085; --acc: #2563eb;
  --crit-bg: #fef3f2; --crit: #b42318; --high-bg: #fff4ed; --high: #c4320a; --med-bg: #fffaeb; --med: #b54708;
  --low-bg: #f2f4f7; --low: #475467; --ok-bg: #ecfdf3; --ok: #067647; --ring-track: #eaecf0; color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body { font: 14px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100vh; display: flex; flex-direction: column; }
a { color: var(--acc); }
code, .mono { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; font-size: .92em; }
h1 { font-size: 24px; letter-spacing: -.01em; margin: 0 0 6px; }
h2 { font-size: 16px; margin: 22px 0 8px; }
.muted { color: var(--mut); } .small { font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.nav { display: flex; justify-content: space-between; align-items: center; padding: 12px 24px; border-bottom: 1px solid var(--line); }
.logo { display: flex; gap: 8px; align-items: center; color: var(--fg); text-decoration: none; font-weight: 800; letter-spacing: -.02em; font-size: 16px; }
.logo b { color: var(--acc); }
.nav nav { display: flex; gap: 18px; align-items: center; }
.nav nav a { color: var(--mut); text-decoration: none; font-size: 13px; }
.theme-toggle { background: none; border: 1px solid var(--line); color: var(--mut); border-radius: 8px; padding: 2px 8px; cursor: pointer; }
.wrap { width: 100%; max-width: 1240px; margin: 0 auto; padding: 24px; flex: 1; }
.foot { border-top: 1px solid var(--line); padding: 14px 24px; color: var(--mut); font-size: 12px; display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
.foot a { color: var(--mut); }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.b { display: inline-block; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel2); color: var(--fg); font-weight: 600; font-size: 13px; text-decoration: none; cursor: pointer; white-space: nowrap; }
.b.p { background: var(--acc); border-color: var(--acc); color: #fff; }
.row-actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-top: 12px; }

.hero { max-width: 760px; margin: 24px auto 20px; text-align: center; }
.hero h1 { font-size: 34px; }
.lede { font-size: 16px; color: var(--mut); }
.check-form { max-width: 760px; margin: 0 auto; }
.label { display: block; font-weight: 600; margin-bottom: 6px; }
textarea, input[type=email], input[type=text], select { width: 100%; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 8px; padding: 10px; font: inherit; }
textarea { font-family: ui-monospace, Menlo, monospace; font-size: 12px; resize: vertical; }
textarea.dragover { border-color: var(--acc); }
.files { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0; font-size: 13px; }
.files input { display: block; margin-top: 4px; color: var(--mut); }
.how { max-width: 760px; margin: 20px auto 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.how p { margin: 4px 0 0; font-size: 13px; }
.notice { max-width: 640px; margin: 40px auto; }
.prose { max-width: 820px; margin: 0 auto; }
.prose table, .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.prose th, .prose td, .tbl th, .tbl td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.tbl th { color: var(--mut); font-weight: 500; }

.sev { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.sev::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sev.critical { background: var(--crit-bg); color: var(--crit); } .sev.high { background: var(--high-bg); color: var(--high); }
.sev.medium { background: var(--med-bg); color: var(--med); } .sev.low { background: var(--low-bg); color: var(--low); }
.sev.healthy { background: var(--ok-bg); color: var(--ok); } .sev.none { background: var(--low-bg); color: var(--mut); }

/* report */
.report { display: grid; grid-template-columns: 1fr 300px; gap: 18px; }
.report-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.summary { grid-column: 1 / -1; display: grid; grid-template-columns: 180px 1fr; gap: 18px; align-items: center; }
.ring { display: block; margin: 0 auto 6px; }
.ring .track { stroke: var(--ring-track); } .ring .val { stroke-linecap: round; }
.ring .val.healthy { stroke: #12b76a; } .ring .val.attention { stroke: #f79009; } .ring .val.risk { stroke: #f04438; }
.ring text { fill: var(--fg); font: 800 26px Inter, system-ui, sans-serif; }
.summary-text { font-size: 15px; line-height: 1.55; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
.kpi { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.kpi .n { font-size: 22px; font-weight: 700; } .kpi .l { color: var(--mut); font-size: 11px; }
.kpi .n.crit { color: var(--crit); } .kpi .n.high { color: var(--high); } .kpi .n.med { color: var(--med); }
.banner { grid-column: 1 / -1; border: 1px solid var(--high); background: var(--high-bg); border-radius: 10px; padding: 10px 14px; }
.deps-panel { padding: 0; overflow-x: auto; }
.deps-tools { padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.tabs, .filters { display: flex; gap: 6px; flex-wrap: wrap; }
.tabs button, .filters button { background: none; border: 1px solid var(--line); color: var(--mut); border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.tabs button[aria-pressed="true"], .filters button[aria-pressed="true"] { color: var(--fg); border-color: var(--acc); }
.tbl td .pk { font-weight: 600; } .tbl td .sub { color: var(--mut); font-size: 11px; }
.tbl tr.row { cursor: pointer; } .tbl tr.detail td { background: var(--panel2); font-size: 12px; }
.tbl tr[hidden] { display: none; }
.bar { display: inline-block; width: 56px; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; vertical-align: middle; }
.bar span { display: block; height: 100%; background: #12b76a; }
.bar.mid span { background: #f79009; } .bar.bad span { background: #f04438; }
.w0 span { width: 0 } .w1 span { width: 10% } .w2 span { width: 20% } .w3 span { width: 30% } .w4 span { width: 40% }
.w5 span { width: 50% } .w6 span { width: 60% } .w7 span { width: 70% } .w8 span { width: 80% } .w9 span { width: 90% } .w10 span { width: 100% }
.side h3 { margin: 0 0 4px; font-size: 14px; }
.step { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.step:last-of-type { border-bottom: 0; }
.num { width: 20px; height: 20px; border-radius: 50%; background: rgba(59,130,246,.15); color: var(--acc); font-weight: 700; font-size: 11px; display: grid; place-items: center; flex: none; }
.total { display: flex; justify-content: space-between; padding-top: 10px; border-top: 1px solid var(--line); }
.expert { margin-top: 14px; border: 1px solid #2c3550; background: linear-gradient(160deg, #141b2e, #0f1320); color: #e6e8ee; border-radius: 12px; padding: 16px; }
.expert p { color: #c7cfe2; font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; } .chips span { font-size: 10px; padding: 2px 7px; border-radius: 999px; border: 1px solid #2c3550; color: #b6c2e0; }
.pdf { margin-top: 14px; border: 1px dashed var(--line); border-radius: 12px; padding: 14px; }
.notify .in { display: flex; gap: 6px; margin-top: 8px; }
.notify .in input { flex: 1; }
.progress { max-width: 560px; margin: 60px auto; text-align: center; }
.spinner { width: 36px; height: 36px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--acc); margin: 0 auto 14px; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.contact-form { max-width: 640px; margin: 0 auto; display: grid; gap: 12px; }
.hp { position: absolute; left: -10000px; }

@media (max-width: 900px) {
  .report, .summary, .files, .how { grid-template-columns: 1fr; }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .wrap { padding: 16px; }
  .nav nav a:not(:first-child) { display: none; }
}
```

- [ ] **Step 9: Create `public/app.js`**

```js
// Progressive enhancement only: every page works without this file.
(() => {
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  } catch { /* storage blocked */ }

  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('[data-theme-toggle]')) {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch { /* ignore */ }
    }
    const copy = t.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.getAttribute('data-copy') || location.href);
      copy.textContent = 'Copied';
    }
    const row = t.closest('tr[data-expand]');
    if (row) {
      const detail = document.getElementById(row.getAttribute('data-expand'));
      if (detail) detail.hidden = !detail.hidden;
    }
    const tab = t.closest('[data-tab]');
    if (tab) {
      const scope = tab.getAttribute('data-tab');
      document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === tab)));
      document.querySelectorAll('tr.row').forEach((r) => { r.dataset.scopeHidden = String(r.getAttribute('data-scope') !== scope); });
      applyRows();
    }
    const filter = t.closest('[data-filter]');
    if (filter) {
      const kind = filter.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === filter)));
      document.querySelectorAll('tr.row').forEach((r) => {
        r.dataset.filterHidden = String(kind !== 'all' && !(r.getAttribute('data-kinds') || '').split(' ').includes(kind));
      });
      applyRows();
    }
  });

  function applyRows() {
    document.querySelectorAll('tr.row').forEach((r) => {
      const hide = r.dataset.scopeHidden === 'true' || r.dataset.filterHidden === 'true';
      r.hidden = hide;
      const d = document.getElementById(r.getAttribute('data-expand') || '');
      if (d && hide) d.hidden = true;
    });
  }

  // Report progress: poll the status endpoint instead of waiting for the meta refresh.
  const status = document.querySelector('[data-status-url]');
  if (status) {
    const url = status.getAttribute('data-status-url');
    const poll = async () => {
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        const j = await r.json();
        if (j.status !== 'running') { location.reload(); return; }
      } catch { /* keep polling */ }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 1000);
  }

  // Drag & drop a file onto the textarea.
  const area = document.querySelector('[data-dropzone] textarea');
  if (area) {
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', async (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.size <= 256 * 1024) area.value = await file.text();
    });
  }
})();
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/web-pages.test.ts tests/unit/turnstile.test.ts`
Expected: PASS. If Eta reports `layout is not defined`, check the template's first line is `<% layout('./layout') %>`. If the 404 test fails because the not-found handler cannot call `reply.page`, register the handler after `decorateReply`, as written above.

- [ ] **Step 11: Commit**

```bash
git add src/web src/mail views public tests
git commit -m "feat(web): app factory, security headers, layout, landing/methodology/privacy pages, brand assets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Submitting a check (rate limits, Turnstile, progress page)

**Files:**
- Create: `src/web/client-ip.ts`, `src/web/limits.ts`, `src/web/routes/check.ts`, `views/progress.eta`, `views/limit.eta`, `tests/helpers/multipart.ts`
- Modify: `src/web/app.ts` (register the route)
- Test: `tests/integration/check-route.test.ts`

**Interfaces:**
- Consumes:
  - `parseInput`/`InputError` (Task 2);
  - `createReport`, `getReport`, `setReportFailed`, `hitLimit`, `dayKey`, `newReportId`, `REPORT_ID_RE` (Task 7);
  - `CheckRunner.submit` (Task 9);
  - `AppDeps`, `reply.page` (Task 10).
- Produces:
  - `clientIp(req: FastifyRequest): string`
  - `ipHash(secret: string, ip: string): string`
  - `consume(deps: AppDeps, kind: 'check' | 'contact' | 'notify', ip: string, limit: number): Promise<boolean>`, which records `metrics.limited(kind)` when denied
  - `consumeGlobal(deps: AppDeps): Promise<boolean>`
  - Routes `POST /check` and `GET /r/:id/status`, plus `loadReportOr404(deps, id)` exported from `routes/check.ts` for reuse in Task 12.

- [ ] **Step 1: Multipart test helper**

`tests/helpers/multipart.ts`:

```ts
export function multipart(fields: Record<string, string | { filename: string; content: string }>) {
  const boundary = '----deps' + Math.random().toString(16).slice(2);
  let body = '';
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    if (typeof value === 'string') {
      body += `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    } else {
      body += `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\nContent-Type: application/json\r\n\r\n${value.content}\r\n`;
    }
  }
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/integration/check-route.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getReport } from '../../src/store/reports.js';
import { testApp } from '../helpers/app.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';
import { multipart } from '../helpers/multipart.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ sources: fakeSources({ npm: { express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }) } }) }); });
afterAll(async () => t.close());

const pkg = JSON.stringify({ name: 'demo', dependencies: { express: '^5.1.0' } });
const post = (fields: Parameters<typeof multipart>[0], ip = '203.0.113.1') => {
  const m = multipart({ 'cf-turnstile-response': 'tok', ...fields });
  return t.app.inject({ method: 'POST', url: '/check', payload: m.payload, headers: { ...m.headers, 'cf-connecting-ip': ip } });
};

describe('POST /check', () => {
  it('creates a report and redirects to it', async () => {
    const res = await post({ packageJson: pkg });
    expect(res.statusCode).toBe(303);
    const id = String(res.headers.location).replace('/r/', '');
    expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
    await t.runner.idle();
    const doc = await getReport(t.db, id);
    expect(doc).toMatchObject({ status: 'done', projectName: 'demo', hasLockfile: false });
    expect(doc?.deps).toEqual([{ name: 'express', spec: '^5.1.0', scope: 'prod', lockVersion: null }]);
  });

  it('accepts an uploaded file and a lockfile', async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/express': { version: '5.1.0' } } });
    const res = await post({ packageJsonFile: { filename: 'package.json', content: pkg }, lockfile: { filename: 'package-lock.json', content: lock } }, '203.0.113.2');
    expect(res.statusCode).toBe(303);
    const doc = await getReport(t.db, String(res.headers.location).slice(3));
    expect(doc?.deps[0]?.lockVersion).toBe('5.1.0');
  });

  it('rejects a failed Turnstile check', async () => {
    t.setTurnstile(false);
    const res = await post({ packageJson: pkg }, '203.0.113.3');
    t.setTurnstile(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('verification');
  });

  it('explains missing or invalid input', async () => {
    expect((await post({}, '203.0.113.4')).body).toContain('Paste your package.json');
    const bad = await post({ packageJson: '{nope' }, '203.0.113.4');
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('This is not valid JSON');
  });

  it('allows 5 checks per IP per day, then offers the check pack', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ packageJson: pkg }, '198.51.100.7')).statusCode);
    expect(codes).toEqual([303, 303, 303, 303, 303, 429]);
    const last = await post({ packageJson: pkg }, '198.51.100.7');
    expect(last.body).toContain('check pack');
    expect(last.body).toContain('name="list" value="pack"');
    expect(t.events).toContain('limited:check');
    expect((await post({ packageJson: pkg }, '198.51.100.8')).statusCode).toBe(303);
  });

  it('answers 503 when the queue is full', async () => {
    const full = await testApp();
    (full.runner as unknown as { submit: () => boolean }).submit = () => false;
    const m = multipart({ 'cf-turnstile-response': 'tok', packageJson: pkg });
    const res = await full.app.inject({ method: 'POST', url: '/check', payload: m.payload, headers: m.headers });
    expect(res.statusCode).toBe(503);
    await full.close();
  });
});

describe('GET /r/:id/status', () => {
  it('returns the status as JSON and 404 for unknown ids', async () => {
    const res = await post({ packageJson: pkg }, '203.0.113.9');
    const id = String(res.headers.location).slice(3);
    const status = await t.app.inject({ url: `/r/${id}/status` });
    expect(['running', 'done']).toContain(status.json().status);
    expect((await t.app.inject({ url: '/r/AAAAAAAAAAAAAAAAAAAAAA/status' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/r/..%2F..%2Fetc/status' })).statusCode).toBe(404);
  });
});
```

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/check-route.test.ts`
Expected: FAIL (404s, because the route doesn't exist yet).

- [ ] **Step 3: Implement `src/web/client-ip.ts` and `src/web/limits.ts`**

```ts
// src/web/client-ip.ts
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/** Cloudflare sets CF-Connecting-IP; port 443 only accepts Cloudflare's ranges, so the header is trusted. */
export function clientIp(req: FastifyRequest): string {
  const h = req.headers['cf-connecting-ip'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && isIP(v.trim()) ? v.trim() : req.ip;
}
```

```ts
// src/web/limits.ts
import { createHmac } from 'node:crypto';
import { dayKey, hitLimit } from '../store/ratelimits.js';
import type { AppDeps } from './app.js';

export function ipHash(secret: string, ip: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export async function consume(deps: AppDeps, kind: 'check' | 'contact' | 'notify', ip: string, limit: number): Promise<boolean> {
  const now = (deps.clock ?? (() => new Date()))();
  const { allowed } = await hitLimit(deps.db, `${kind}:${ipHash(deps.config.IP_HASH_SECRET, ip)}:${dayKey(now)}`, limit, now);
  if (!allowed) deps.metrics?.limited(kind);
  return allowed;
}

export async function consumeGlobal(deps: AppDeps): Promise<boolean> {
  const now = (deps.clock ?? (() => new Date()))();
  const { allowed } = await hitLimit(deps.db, `global:check:${dayKey(now)}`, deps.config.GLOBAL_CHECKS_PER_DAY, now);
  if (!allowed) deps.metrics?.limited('global');
  return allowed;
}
```

- [ ] **Step 4: Implement `src/web/routes/check.ts`**

```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { InputError, parseInput } from '../../analyze/parse.js';
import { newReportId, REPORT_ID_RE } from '../../store/ids.js';
import { createReport, getReport, setReportFailed, type ReportDoc } from '../../store/reports.js';
import type { AppDeps } from '../app.js';
import { clientIp } from '../client-ip.js';
import { consume, consumeGlobal } from '../limits.js';

type CheckBody = Partial<Record<'packageJson' | 'packageJsonFile' | 'lockfile' | 'cf-turnstile-response', string | Buffer>>;

const asText = (v: string | Buffer | undefined): string | null => {
  if (v === undefined) return null;
  const s = Buffer.isBuffer(v) ? v.toString('utf8') : v;
  return s.trim() ? s : null;
};

export async function loadReportOr404(deps: AppDeps, id: string): Promise<ReportDoc | null> {
  if (!REPORT_ID_RE.test(id)) return null;
  return getReport(deps.db, id);
}

export default async function checkRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/check', async (req, reply: FastifyReply) => {
    const body = (req.body ?? {}) as CheckBody;
    const ip = clientIp(req);

    const token = asText(body['cf-turnstile-response']) ?? undefined;
    if (!(await deps.turnstile.verify(token, ip))) {
      return reply.page('./notice', { title: 'Verification failed', heading: 'Please complete the verification', message: 'The bot check did not pass. Go back, wait for the check box to turn green, and submit again.', back: true }, 400);
    }

    const pkgText = asText(body.packageJsonFile) ?? asText(body.packageJson);
    if (!pkgText) throw new InputError('Paste your package.json or choose the file to upload.');
    const parsed = parseInput(pkgText, asText(body.lockfile));

    if (!(await consume(deps, 'check', ip, deps.config.CHECKS_PER_DAY))) {
      return reply.page('./limit', { title: 'Daily limit reached', turnstile: true, perDay: deps.config.CHECKS_PER_DAY }, 429);
    }
    if (!(await consumeGlobal(deps))) {
      return reply.page('./notice', { title: 'Busy', heading: 'Daily capacity reached', message: 'The free service has reached its daily capacity. Please try again tomorrow.', back: true }, 503);
    }

    const id = newReportId();
    await createReport(deps.db, { _id: id, projectName: parsed.projectName, hasLockfile: parsed.hasLockfile, deps: parsed.deps, skipped: parsed.skipped },
      (deps.clock ?? (() => new Date()))());
    if (!deps.runner.submit(id)) {
      await setReportFailed(deps.db, id, 'busy');
      return reply.page('./notice', { title: 'Busy', heading: 'Too many checks right now', message: 'Please try again in a minute.', back: true }, 503);
    }
    return reply.redirect(`/r/${id}`, 303);
  });

  app.get<{ Params: { id: string } }>('/r/:id/status', async (req, reply) => {
    const doc = await loadReportOr404(deps, req.params.id);
    if (!doc) return reply.code(404).send({ status: 'not-found' });
    return { status: doc.status };
  });
}
```

Register it in `src/web/app.ts` right after `await app.register(pages, deps);`:

```ts
import checkRoutes from './routes/check.js';
// …
await app.register(checkRoutes, deps);
```

- [ ] **Step 5: Create `views/progress.eta` and `views/limit.eta`**

`views/progress.eta`:

```html
<% layout('./layout', { refresh: 3, title: 'Checking…' }) %>
<section class="panel progress" data-status-url="/r/<%= it.id %>/status">
  <div class="spinner" aria-hidden="true"></div>
  <h1>Checking <%= it.projectName %>…</h1>
  <p class="muted">Looking up <%= it.count %> dependencies on npm, OSV.dev and deps.dev. Large projects can take up to 20 seconds.</p>
</section>
```

`views/limit.eta`:

```html
<% layout('./layout') %>
<section class="panel notice">
  <h1>You've used today's <%= it.perDay %> free checks</h1>
  <p>Existing reports stay available. You can view and share them any time.</p>
  <p><b>Need more checks?</b> A check pack (100 checks, €9) is coming. Leave your email and you'll get a single email when it's available.</p>
  <%~ include('./partials/notify-form', { list: 'pack', reportId: '' }) %>
  <p class="row-actions"><a class="b" href="/">← Back</a></p>
</section>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/check-route.test.ts`
Expected: PASS. If uploads arrive as objects instead of Buffers, confirm that `attachFieldsToBody: 'keyValues'` is set (Task 10). That mode turns file parts into Buffers and fields into strings.

- [ ] **Step 7: Commit**

```bash
git add src/web views tests
git commit -m "feat(web): submit checks with Turnstile, per-IP and global limits, progress status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Report page (layout A) and exports

**Files:**
- Create: `src/web/format.ts`, `src/web/report-view.ts`, `src/web/routes/report.ts`, `views/report.eta`
- Modify: `src/web/app.ts` (register the route)
- Test: `tests/unit/format.test.ts`, `tests/integration/report-route.test.ts`

**Interfaces:**
- Consumes:
  - `ReportDoc` (Task 7); `ReportResult`, `RISK_ORDER` (Task 2); `formatEffort` (Task 5);
  - `loadReportOr404` (Task 11); `analyzeDeps` (Task 9, used by the tests only).
- Produces:
  - `formatDownloads(n: number | null): string`, `formatMonth(iso: string | null): string`, `formatDateTime(d: Date): string`, `scorecardBar(score: number | null): string`, `ringDash(score: number): { dash: number; gap: number }`
  - `toReportView(doc: ReportDoc, publicUrl: string): ReportView`, `toMarkdown(doc: ReportDoc, publicUrl: string): string`
  - Routes `GET /r/:id`, `GET /r/:id.md` and `GET /r/:id.json` (one handler)

- [ ] **Step 1: Write the failing unit tests for formatting**

`tests/unit/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDownloads, formatMonth, ringDash, scorecardBar } from '../../src/web/format.js';

describe('format', () => {
  it.each([[null, '—'], [950, '950'], [12_400, '12.4k'], [1_100_000, '1.1M'], [58_200_000, '58.2M']])('downloads %s', (n, s) => {
    expect(formatDownloads(n)).toBe(s);
  });
  it('formats months and scorecards', () => {
    expect(formatMonth('2021-02-20T10:00:00Z')).toBe('Feb 2021');
    expect(formatMonth(null)).toBe('—');
    expect(scorecardBar(8.5)).toBe('bar w9');
    expect(scorecardBar(5.5)).toBe('bar mid w6');
    expect(scorecardBar(2.4)).toBe('bar bad w2');
    expect(scorecardBar(null)).toBe('');
  });
  it('computes the score ring', () => {
    const { dash, gap } = ringDash(58);
    expect(Math.round(dash + gap)).toBe(239); // circumference for r=38
    expect(Math.round(dash)).toBe(138); // 58% of 238.76
  });
});
```

Run: `npx vitest run tests/unit/format.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/web/format.ts`**

```ts
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const RING_R = 38;
const CIRC = 2 * Math.PI * RING_R;

export function formatDownloads(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function formatMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function scorecardBar(score: number | null): string {
  if (score === null) return '';
  const w = Math.max(0, Math.min(10, Math.round(score)));
  const tone = score >= 7 ? '' : score >= 4 ? ' mid' : ' bad';
  return `bar${tone} w${w}`;
}

export function ringDash(score: number): { dash: number; gap: number } {
  const dash = (Math.max(0, Math.min(100, score)) / 100) * CIRC;
  return { dash, gap: CIRC - dash };
}
```

Run: `npx vitest run tests/unit/format.test.ts`. Expected: PASS.

- [ ] **Step 3: Write the failing route tests**

`tests/integration/report-route.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeDeps } from '../../src/check/analyze-deps.js';
import { newReportId } from '../../src/store/ids.js';
import { createReport, setReportFailed, setReportResult } from '../../src/store/reports.js';
import type { StoredDep } from '../../src/analyze/types.js';
import { testApp } from '../helpers/app.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const now = new Date('2026-10-12T18:42:00Z');
const sources = fakeSources({
  npm: {
    lodash: npmInfo({ latest: '4.17.21', versions: ['4.17.15', '4.17.21'] }),
    request: npmInfo({ latest: '2.88.2', versions: ['2.88.2'], lastPublish: '2020-02-11T00:00:00Z',
      deprecatedLatest: '<script>alert(1)</script> use fetch', deprecated: { '2.88.2': '<script>alert(1)</script> use fetch' } }),
    vitest: npmInfo({ latest: '5.0.2', versions: ['5.0.2'] }),
  },
  vulns: { 'lodash@4.17.15': ['GHSA-35jh-r3h4-6jhm'] },
  advisories: { 'GHSA-35jh-r3h4-6jhm': { id: 'GHSA-35jh-r3h4-6jhm', summary: 'Command Injection in lodash', severity: 'HIGH',
    npmRanges: { lodash: [[{ introduced: '0' }, { fixed: '4.17.21' }]] } } },
});

async function doneReport(deps: StoredDep[], projectName = 'acme-shop-api', unavailable: string[] = []) {
  const id = newReportId();
  await createReport(t.db, { _id: id, projectName, hasLockfile: false, deps, skipped: [{ name: 'internal', spec: 'file:../x', scope: 'prod', reason: 'Not from the npm registry' }] }, now);
  const result = await analyzeDeps({ deps }, sources, {}, now);
  await setReportResult(t.db, id, { ...result, partial: unavailable as never });
  return id;
}

const deps: StoredDep[] = [
  { name: 'lodash', spec: '4.17.15', scope: 'prod', lockVersion: null },
  { name: 'request', spec: '^2.88.2', scope: 'prod', lockVersion: null },
  { name: 'vitest', spec: '^5.0.2', scope: 'dev', lockVersion: null },
];

describe('GET /r/:id', () => {
  it('renders the report with score, summary, plan and brand card', async () => {
    const id = await doneReport(deps);
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.statusCode).toBe(200);
    for (const s of ['acme-shop-api', 'Needs attention', 'Recommended upgrade order', 'Upgrade to 4.17.21',
      'GHSA-35jh-r3h4-6jhm', 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', 'may already be fixed',
      `/contact?r=${id}`, 'independent backend engineer', 'name="list" value="pdf"', 'Not from the npm registry']) {
      expect(res.body).toContain(s);
    }
    expect(res.body).not.toMatch(OWNER_NAME_RE);
  });

  it('escapes hostile text from package.json and npm', async () => {
    const id = await doneReport(deps, '<img src=x onerror=alert(1)>');
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows the partial-data banner', async () => {
    const id = await doneReport(deps, 'p', ['osv']);
    expect((await t.app.inject({ url: `/r/${id}` })).body).toContain('Partial data');
  });

  it('renders an empty project', async () => {
    const id = await doneReport([]);
    const res = await t.app.inject({ url: `/r/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('No dependencies to check.');
    expect(res.body).toContain('>100<');
  });

  it('shows progress while running and a message when failed', async () => {
    const id = newReportId();
    await createReport(t.db, { _id: id, projectName: 'p', hasLockfile: false, deps: [], skipped: [] }, now);
    const running = await t.app.inject({ url: `/r/${id}` });
    expect(running.body).toContain(`data-status-url="/r/${id}/status"`);
    expect(running.body).toContain('http-equiv="refresh"');
    await setReportFailed(t.db, id, 'timeout');
    expect((await t.app.inject({ url: `/r/${id}` })).body).toContain('took too long');
  });

  it('exports Markdown and JSON', async () => {
    const id = await doneReport(deps);
    const md = await t.app.inject({ url: `/r/${id}.md` });
    expect(md.headers['content-type']).toContain('text/markdown');
    expect(md.body).toContain('| lodash | 4.17.15 | 4.17.21 | High |');
    const json = await t.app.inject({ url: `/r/${id}.json` });
    expect(json.json()).toMatchObject({ id, projectName: 'acme-shop-api', score: expect.any(Number) });
  });

  it('404s unknown and malformed ids', async () => {
    expect((await t.app.inject({ url: '/r/AAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/r/%3Cscript%3E' })).statusCode).toBe(404);
  });
});
```

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/report-route.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement `src/web/report-view.ts`**

```ts
import { formatEffort } from '../analyze/plan.js';
import { RISK_ORDER, type PackageResult, type Risk } from '../analyze/types.js';
import type { ReportDoc } from '../store/reports.js';
import { formatDateTime, formatDownloads, formatMonth, ringDash, scorecardBar } from './format.js';

const RISK_LABEL: Record<Risk, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', healthy: 'Healthy' };
const SOURCE_LABEL: Record<string, string> = { npm: 'npm registry', downloads: 'npm download counts', osv: 'OSV.dev vulnerabilities', 'deps.dev': 'deps.dev scorecards' };

function reason(p: PackageResult): string {
  if (p.status === 'not-found') return "Not on the public npm registry (private packages aren't checked)";
  if (p.status === 'unresolved') {
    if (p.resolution === 'no-match') return 'No published version matches this range';
    if (p.resolution === 'invalid-spec') return 'Not a valid version range';
    return 'npm registry unavailable, try again later';
  }
  if (p.findings.length === 0) return p.latest === p.resolved ? 'Up to date' : 'No known issues';
  return p.findings.map((f) => f.text).join(' · ');
}

function kinds(p: PackageResult): string {
  const k = new Set<string>();
  for (const f of p.findings) {
    if (f.kind === 'vulnerability') k.add('vulnerable');
    if (f.kind === 'deprecated' || f.kind === 'version-deprecated') k.add('deprecated');
    if (f.kind === 'idle' || f.kind === 'single-maintainer') k.add('maintenance');
  }
  return [...k].join(' ');
}

export function toReportView(doc: ReportDoc, publicUrl: string) {
  const r = doc.result;
  if (!r) throw new Error('report has no result');
  const sorted = [...r.packages].sort((a, b) =>
    Number(b.status === 'checked') - Number(a.status === 'checked') || RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.name.localeCompare(b.name));
  const ring = ringDash(r.score);
  return {
    id: doc._id,
    projectName: doc.projectName,
    depCount: r.counts.total,
    prodCount: r.packages.filter((p) => p.scope === 'prod').length,
    devCount: r.packages.filter((p) => p.scope === 'dev').length,
    checkedAt: formatDateTime(doc.finishedAt ?? doc.createdAt),
    shareUrl: `${publicUrl}/r/${doc._id}`,
    hasLockfile: doc.hasLockfile,
    score: r.score,
    label: r.label,
    ringClass: r.label === 'Healthy' ? 'healthy' : r.label === 'Needs attention' ? 'attention' : 'risk',
    ring,
    summary: r.summary,
    counts: r.counts,
    partial: r.partial.length ? `Partial data: ${r.partial.map((s) => SOURCE_LABEL[s] ?? s).join(', ')} could not be reached. Re-run the check later for complete results.` : null,
    rows: sorted.map((p, i) => ({
      idx: i, name: p.name, scope: p.scope, risk: p.status === 'checked' ? p.risk : 'none',
      riskLabel: p.status === 'checked' ? RISK_LABEL[p.risk] : 'Not checked',
      version: p.resolved ?? p.spec, latest: p.latest ?? '—', lastRelease: formatMonth(p.lastPublish),
      maintainers: p.maintainers ?? '—', downloads: formatDownloads(p.downloads),
      scorecard: p.scorecard === null ? '—' : p.scorecard.toFixed(1), bar: scorecardBar(p.scorecard),
      reason: reason(p), kinds: kinds(p), worstCase: p.worstCase && p.risk !== 'healthy',
      deprecated: p.deprecated,
      vulns: p.vulns.map((v) => ({ ...v, riskLabel: RISK_LABEL[v.risk], url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}` })),
      expandable: p.vulns.length > 0 || p.deprecated !== null,
    })),
    plan: r.plan.steps.map((s, i) => ({ n: i + 1, name: s.name, action: s.action, effort: s.effort === 'watch' ? 'monitor' : formatEffort(s.minHours, s.maxHours), risk: s.risk })),
    planTotal: r.plan.totalMaxHours > 0 ? formatEffort(r.plan.totalMinHours, r.plan.totalMaxHours) : null,
    skipped: doc.skipped,
    contactUrl: `/contact?r=${doc._id}`,
  };
}

export type ReportView = ReturnType<typeof toReportView>;

const cell = (s: string | number | null) => String(s ?? '—').replace(/[|\r\n]+/g, ' ');

export function toMarkdown(doc: ReportDoc, publicUrl: string): string {
  const v = toReportView(doc, publicUrl);
  const lines = [
    `# Dependency health: ${cell(v.projectName)}`,
    '',
    `**Score ${v.score}/100 (${v.label})** · checked ${v.checkedAt} · [full report](${v.shareUrl})`,
    '',
    v.summary,
    '',
    '| Package | In use | Latest | Risk | Notes |',
    '|---|---|---|---|---|',
    ...v.rows.map((r) => `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.latest)} | ${r.riskLabel} | ${cell(r.reason)} |`),
  ];
  if (v.plan.length) {
    lines.push('', '## Upgrade order', '', ...v.plan.map((s) => `${s.n}. **${cell(s.name)}**: ${cell(s.action)} (${s.effort})`));
    if (v.planTotal) lines.push('', `Total estimate: ${v.planTotal}`);
  }
  lines.push('', `_Generated by [noticely/deps](${publicUrl}). Data: npm registry, OSV.dev, deps.dev._`, '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Implement `src/web/routes/report.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { toMarkdown, toReportView } from '../report-view.js';
import { loadReportOr404 } from './check.js';

const FAILED: Record<string, string> = {
  timeout: 'The check took too long. Upstream services may be slow right now; please try again in a few minutes.',
  busy: 'Too many checks were running at the same time. Please try again in a minute.',
  error: 'Something went wrong while checking. Please try again.',
};

export default async function reportRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { id: string } }>('/r/:id', async (req, reply) => {
    const m = /^(.+)\.(md|json)$/.exec(req.params.id);
    const id = m?.[1] ?? req.params.id;
    const format = m?.[2];
    const doc = await loadReportOr404(deps, id);
    if (!doc) return reply.callNotFound();

    if (doc.status === 'running') {
      if (format) return reply.code(409).type('text/plain').send('This report is still running.');
      return reply.page('./progress', { id: doc._id, projectName: doc.projectName, count: doc.deps.length });
    }
    if (doc.status === 'failed' || !doc.result) {
      return reply.page('./notice', { title: 'Check failed', heading: "This check didn't finish", message: FAILED[doc.error ?? 'error'] ?? FAILED.error, back: true });
    }
    if (format === 'json') {
      return reply.type('application/json; charset=utf-8').send({
        id: doc._id, projectName: doc.projectName, createdAt: doc.createdAt, hasLockfile: doc.hasLockfile, skipped: doc.skipped, ...doc.result,
      });
    }
    if (format === 'md') return reply.type('text/markdown; charset=utf-8').send(toMarkdown(doc, deps.config.PUBLIC_URL));
    const r = toReportView(doc, deps.config.PUBLIC_URL);
    return reply.page('./report', { title: `${doc.projectName} · dependency report`, turnstile: true, r });
  });
}
```

In `src/web/app.ts`, after the check routes: `import reportRoutes from './routes/report.js';` and `await app.register(reportRoutes, deps);`.

- [ ] **Step 6: Create `views/report.eta`**

```html
<% layout('./layout') %>
<% const r = it.r %>
<div class="report">
  <div class="report-head">
    <div>
      <h1><%= r.projectName %></h1>
      <div class="muted small"><%= r.depCount %> direct dependencies · checked <%= r.checkedAt %> · <%= r.hasLockfile ? 'exact versions from lockfile' : 'no lockfile: lowest matching versions (worst case)' %></div>
    </div>
    <div class="row-actions">
      <button type="button" class="b" data-copy="<%= r.shareUrl %>">Copy link</button>
      <a class="b" href="/r/<%= r.id %>.md">Markdown</a>
      <a class="b p" href="/">Check another file</a>
    </div>
  </div>

  <% if (r.partial) { %><div class="banner"><%= r.partial %></div><% } %>

  <section class="panel summary">
    <div>
      <svg class="ring" width="100" height="100" viewBox="0 0 100 100" role="img" aria-label="Health score <%= r.score %> out of 100">
        <circle class="track" cx="50" cy="50" r="38" fill="none" stroke-width="10"></circle>
        <circle class="val <%= r.ringClass %>" cx="50" cy="50" r="38" fill="none" stroke-width="10" stroke-dasharray="<%= r.ring.dash.toFixed(1) %> <%= r.ring.gap.toFixed(1) %>" transform="rotate(-90 50 50)"></circle>
        <text x="50" y="59" text-anchor="middle"><%= r.score %></text>
      </svg>
      <div class="center"><b><%= r.label %></b><div class="muted small">Health score / 100</div></div>
    </div>
    <div>
      <p class="summary-text"><%= r.summary %></p>
      <div class="kpis">
        <div class="kpi"><div class="n crit"><%= r.counts.vulnerabilities %></div><div class="l">Known vulnerabilities</div></div>
        <div class="kpi"><div class="n high"><%= r.counts.deprecated %></div><div class="l">Deprecated</div></div>
        <div class="kpi"><div class="n med"><%= r.counts.maintenance %></div><div class="l">Maintenance risk</div></div>
        <div class="kpi"><div class="n"><%= r.counts.majorsBehind %></div><div class="l">Major versions behind</div></div>
      </div>
    </div>
  </section>

  <section class="panel deps-panel">
    <div class="deps-tools">
      <div class="tabs">
        <button type="button" data-tab="prod" aria-pressed="true">dependencies (<%= r.prodCount %>)</button>
        <button type="button" data-tab="dev" aria-pressed="false">devDependencies (<%= r.devCount %>)</button>
      </div>
      <div class="filters">
        <button type="button" data-filter="all" aria-pressed="true">All</button>
        <button type="button" data-filter="vulnerable" aria-pressed="false">Vulnerable</button>
        <button type="button" data-filter="deprecated" aria-pressed="false">Deprecated</button>
        <button type="button" data-filter="maintenance" aria-pressed="false">Maintenance</button>
      </div>
    </div>
    <table class="tbl">
      <thead><tr><th>Package</th><th>In use → Latest</th><th>Last release</th><th>Maint.</th><th>Downloads/wk</th><th>Scorecard</th><th>Risk</th></tr></thead>
      <tbody>
      <% r.rows.forEach(function (p) { %>
        <tr class="row" data-scope="<%= p.scope %>" data-kinds="<%= p.kinds %>" <% if (p.expandable) { %>data-expand="d<%= p.idx %>"<% } %> <% if (p.scope === 'dev') { %>hidden<% } %>>
          <td><div class="pk"><%= p.name %></div><div class="sub"><%= p.reason %><% if (p.worstCase) { %> · may already be fixed, add your lockfile<% } %></div></td>
          <td class="mono"><%= p.version %> → <%= p.latest %></td>
          <td><%= p.lastRelease %></td>
          <td><%= p.maintainers %></td>
          <td><%= p.downloads %></td>
          <td><% if (p.bar) { %><span class="<%= p.bar %>"><span></span></span> <% } %><%= p.scorecard %></td>
          <td><span class="sev <%= p.risk %>"><%= p.riskLabel %></span></td>
        </tr>
        <% if (p.expandable) { %>
        <tr class="detail" id="d<%= p.idx %>" hidden>
          <td colspan="7">
            <% if (p.deprecated) { %><p><b>Deprecation notice:</b> <%= p.deprecated %></p><% } %>
            <% p.vulns.forEach(function (v) { %>
              <div><a href="<%= v.url %>" rel="nofollow noopener noreferrer" class="mono"><%= v.id %></a> · <span class="sev <%= v.risk %>"><%= v.riskLabel %></span> · <%= v.summary %><% if (v.fixedIn) { %> · fixed in <span class="mono"><%= v.fixedIn %></span><% } %></div>
            <% }) %>
          </td>
        </tr>
        <% } %>
      <% }) %>
      <% if (r.rows.length === 0) { %><tr><td colspan="7" class="muted">No dependencies to check.</td></tr><% } %>
      </tbody>
    </table>
    <% if (r.skipped.length) { %>
      <div class="deps-tools muted small">Not checked: <% r.skipped.forEach(function (s, i) { %><%= i ? ', ' : '' %><span class="mono"><%= s.name %></span> (<%= s.reason %>)<% }) %></div>
    <% } %>
  </section>

  <aside class="side">
    <div class="panel">
      <h3>Recommended upgrade order</h3>
      <div class="muted small">Highest risk removed per hour first · rough estimates</div>
      <% if (r.plan.length === 0) { %><p class="muted">Nothing to do right now.</p><% } %>
      <% r.plan.forEach(function (s) { %>
        <div class="step"><div class="num"><%= s.n %></div><div><b><%= s.name %>:</b> <%= s.action %><div class="muted small"><%= s.effort %></div></div></div>
      <% }) %>
      <% if (r.planTotal) { %><div class="total"><span class="muted">Total estimate</span><b><%= r.planTotal %></b></div><% } %>
    </div>

    <div class="expert">
      <b>Need these upgrades done?</b>
      <div class="chips"><span>Node.js</span><span>MongoDB</span><span>Docker</span><span>Upgrades &amp; migrations</span></div>
      <p>noticely is built by an independent backend engineer. Fixed price, tested, with a written handover.</p>
      <a class="b p" href="<%= r.contactUrl %>">Get a fixed-price quote →</a>
    </div>

    <div class="pdf">
      <b>Full PDF report</b> <span class="sev none">coming soon</span>
      <p class="muted small">Findings, evidence and this upgrade plan as a document you can hand to your team or client.</p>
      <%~ include('./partials/notify-form', { list: 'pdf', reportId: r.id }) %>
    </div>
  </aside>
</div>
```

Add `.center { text-align: center; }` to `public/app.css`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/report-route.test.ts tests/unit/format.test.ts`
Expected: PASS.

The empty-project test looks for `>100<`, which is the `<text>` element in the ring. In the Markdown test, lodash's row reads `| lodash | 4.17.15 | 4.17.21 | High |` because the fake gives it a single High advisory.

- [ ] **Step 8: Commit**

```bash
git add src/web views public tests
git commit -m "feat(web): report page (layout A) with plan, brand card, PDF notify box, Markdown/JSON exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Notify-me lists (double opt-in) and the Resend mailer

**Files:**
- Create: `src/store/subscribers.ts`, `src/web/routes/notify.ts`
- Modify: `src/mail/mailer.ts` (add the Resend implementation), `src/web/app.ts` (register the route)
- Test: `tests/unit/mailer.test.ts`, `tests/integration/notify.test.ts`

**Interfaces:**
- Consumes: `Mailer` (Task 10), `newToken`/`hashToken`/`TOKEN_RE`/`REPORT_ID_RE` (Task 7), `consume`/`clientIp` (Task 11).
- Produces:
  - `createResendMailer(o: { apiKey: string; from: string; fetch: FetchFn }): Mailer`
  - `type List = 'pdf' | 'pack'`
  - `requestSignup(db, email: string, list: List, tokenHash: string, now: Date): Promise<'pending' | 'confirmed'>`
  - `confirmSignup(db, tokenHash: string, now: Date): Promise<{ result: 'confirmed' | 'already' | 'invalid'; list?: List }>`
  - `unsubscribe(db, tokenHash: string, now: Date): Promise<'ok' | 'invalid'>`
  - Routes: `POST /notify`, `GET /confirm/:token`, `GET /unsubscribe/:token`

- [ ] **Step 1: Write the failing mailer test**

`tests/unit/mailer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createResendMailer } from '../../src/mail/mailer.js';
import { fakeFetch } from '../helpers/fakes.js';

describe('Resend mailer', () => {
  it('posts to the Resend API with auth and reply_to', async () => {
    const f = fakeFetch(() => ({ body: { id: 'x' } }));
    await createResendMailer({ apiKey: 're_test', from: 'noticely <hello@noticely.dev>', fetch: f.fetch })
      .send({ to: 'a@b.test', subject: 'Hi', text: 'Body', replyTo: 'c@d.test' });
    expect(f.calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ from: 'noticely <hello@noticely.dev>', to: ['a@b.test'], subject: 'Hi', text: 'Body', reply_to: 'c@d.test' });
  });

  it('throws when Resend rejects the email', async () => {
    const f = fakeFetch(() => ({ status: 422, body: { message: 'bad' } }));
    await expect(createResendMailer({ apiKey: 'k', from: 'x <x@y.z>', fetch: f.fetch }).send({ to: 'a@b.test', subject: 's', text: 't' }))
      .rejects.toThrow(/422/);
  });
});
```

- [ ] **Step 2: Add `createResendMailer` to `src/mail/mailer.ts`**

```ts
import type { FetchFn } from '../sources/http.js';

export function createResendMailer(o: { apiKey: string; from: string; fetch: FetchFn }): Mailer {
  return {
    async send(m) {
      const res = await o.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}
```

Put the `import` at the top of the file. Run `npx vitest run tests/unit/mailer.test.ts` and expect PASS (run it once before the change to see it FAIL).

- [ ] **Step 3: Write the failing notify tests**

`tests/integration/notify.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../helpers/app.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const form = (o: Record<string, string>, ip = '203.0.113.20') => t.app.inject({
  method: 'POST', url: '/notify', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
  payload: new URLSearchParams({ 'cf-turnstile-response': 'tok', ...o }).toString(),
});
const tokenFrom = (text: string, kind: 'confirm' | 'unsubscribe') => new RegExp(`/${kind}/([A-Za-z0-9_-]{43})`).exec(text)?.[1] ?? '';

describe('notify-me', () => {
  it('double opt-in: email, confirm, idempotent repeat', async () => {
    const res = await form({ email: 'Dev@Example.com', list: 'pdf', r: 'sample' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Check your inbox');
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]).toMatchObject({ to: 'dev@example.com', subject: expect.stringContaining('Confirm') });
    const token = tokenFrom(t.mails[0]?.text ?? '', 'confirm');
    expect(tokenFrom(t.mails[0]?.text ?? '', 'unsubscribe')).toBe(token);

    const confirm = await t.app.inject({ url: `/confirm/${token}` });
    expect(confirm.body).toContain("You're on the list");
    expect(t.events).toContain('confirmed:pdf');
    expect((await t.app.inject({ url: `/confirm/${token}` })).body).toContain('already confirmed');

    // Signing up again after confirming: same page, no new email
    const again = await form({ email: 'dev@example.com', list: 'pdf' });
    expect(again.body).toContain('Check your inbox');
    expect(t.mails).toHaveLength(1);
  });

  it('unsubscribes, and handles unknown or malformed tokens kindly', async () => {
    await form({ email: 'u@example.com', list: 'pack' }, '203.0.113.21');
    const token = tokenFrom(t.mails.at(-1)?.text ?? '', 'unsubscribe');
    expect((await t.app.inject({ url: `/unsubscribe/${token}` })).body).toContain('unsubscribed');
    expect((await t.app.inject({ url: `/unsubscribe/${token}` })).body).toContain('unsubscribed');
    const unknown = await t.app.inject({ url: `/unsubscribe/${'A'.repeat(43)}` });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body).toContain('no longer valid');
    expect((await t.app.inject({ url: '/confirm/<script>' })).body).toContain('no longer valid');
  });

  it('validates input, Turnstile and the daily limit', async () => {
    expect((await form({ email: 'not-an-email', list: 'pdf' }, '203.0.113.22')).statusCode).toBe(400);
    expect((await form({ email: 'a@b.test', list: 'vip' }, '203.0.113.22')).statusCode).toBe(400);
    t.setTurnstile(false);
    expect((await form({ email: 'a@b.test', list: 'pdf' }, '203.0.113.22')).statusCode).toBe(400);
    t.setTurnstile(true);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await form({ email: `x${i}@b.test`, list: 'pack' }, '203.0.113.23')).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });
});
```

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/notify.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement `src/store/subscribers.ts`**

```ts
import type { Db } from 'mongodb';

export type List = 'pdf' | 'pack';
const PENDING_TTL_MS = 7 * 86_400_000;
const UNSUB_TTL_MS = 30 * 86_400_000;

interface SubscriberDoc {
  email: string;
  list: List;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  tokenHash: string;
  createdAt: Date;
  confirmedAt?: Date;
  expiresAt?: Date;
}

const subs = (db: Db) => db.collection<SubscriberDoc>('subscribers');

export async function requestSignup(db: Db, email: string, list: List, tokenHash: string, now: Date): Promise<'pending' | 'confirmed'> {
  const existing = await subs(db).findOne({ email, list });
  if (existing?.status === 'confirmed') return 'confirmed';
  await subs(db).updateOne(
    { email, list },
    { $set: { status: 'pending', tokenHash, expiresAt: new Date(now.getTime() + PENDING_TTL_MS) }, $setOnInsert: { createdAt: now }, $unset: { confirmedAt: '' } },
    { upsert: true },
  );
  return 'pending';
}

export async function confirmSignup(db: Db, tokenHash: string, now: Date): Promise<{ result: 'confirmed' | 'already' | 'invalid'; list?: List }> {
  const doc = await subs(db).findOneAndUpdate(
    { tokenHash, status: 'pending' },
    { $set: { status: 'confirmed', confirmedAt: now }, $unset: { expiresAt: '' } },
    { returnDocument: 'after' },
  );
  if (doc) return { result: 'confirmed', list: doc.list };
  const other = await subs(db).findOne({ tokenHash });
  return other?.status === 'confirmed' ? { result: 'already', list: other.list } : { result: 'invalid' };
}

export async function unsubscribe(db: Db, tokenHash: string, now: Date): Promise<'ok' | 'invalid'> {
  const res = await subs(db).updateOne(
    { tokenHash, status: { $in: ['pending', 'confirmed'] } },
    { $set: { status: 'unsubscribed', expiresAt: new Date(now.getTime() + UNSUB_TTL_MS) } },
  );
  if (res.matchedCount) return 'ok';
  return (await subs(db).findOne({ tokenHash, status: 'unsubscribed' })) ? 'ok' : 'invalid';
}
```

- [ ] **Step 5: Implement `src/web/routes/notify.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashToken, newToken, REPORT_ID_RE, TOKEN_RE } from '../../store/ids.js';
import { confirmSignup, requestSignup, unsubscribe, type List } from '../../store/subscribers.js';
import type { AppDeps } from '../app.js';
import { clientIp } from '../client-ip.js';
import { consume } from '../limits.js';

const Body = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  list: z.enum(['pdf', 'pack']),
  r: z.string().optional(),
  'cf-turnstile-response': z.string().max(2048).optional(),
});

const LIST_NAME: Record<List, string> = { pdf: 'the full PDF report', pack: 'check packs' };
const INVALID = { title: 'Link expired', heading: 'This link is no longer valid', message: 'It may have expired or already been used. You can sign up again from any report page.', back: true };

export default async function notifyRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const now = () => (deps.clock ?? (() => new Date()))();

  app.post('/notify', async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.page('./notice', { title: 'Check your email', heading: 'That email address looks wrong', message: 'Please go back and enter a valid email address.', back: true }, 400);
    }
    const { email, list } = parsed.data;
    const ip = clientIp(req);
    if (!(await deps.turnstile.verify(parsed.data['cf-turnstile-response'], ip))) {
      return reply.page('./notice', { title: 'Verification failed', heading: 'Please complete the verification', message: 'Go back, wait for the check box to turn green, and submit again.', back: true }, 400);
    }
    if (!(await consume(deps, 'notify', ip, 5))) {
      return reply.page('./notice', { title: 'Too many requests', heading: 'Too many sign-ups from your network today', message: 'Please try again tomorrow.', back: true }, 429);
    }
    const token = newToken();
    if ((await requestSignup(deps.db, email, list, hashToken(token), now())) === 'pending') {
      const base = deps.config.PUBLIC_URL;
      await deps.mailer.send({
        to: email,
        subject: `Confirm: notify me about ${LIST_NAME[list]}`,
        text: [
          `Someone (hopefully you) asked to be notified when ${LIST_NAME[list]} become available on noticely/deps.`,
          '',
          `Confirm: ${base}/confirm/${token}`,
          '',
          "If this wasn't you, ignore this email and nothing happens; the request expires in 7 days.",
          `Unsubscribe at any time: ${base}/unsubscribe/${token}`,
        ].join('\n'),
      }).catch((err) => req.log.error({ err }, 'confirmation email failed'));
    }
    // Same answer whether or not the address was already confirmed, so the form can't be used to probe the lists.
    const back = parsed.data.r && REPORT_ID_RE.test(parsed.data.r) ? { href: `/r/${parsed.data.r}`, label: 'Back to the report' } : undefined;
    return reply.page('./notice', { title: 'Check your inbox', heading: 'Check your inbox', message: `If ${email} isn't on the list yet, a confirmation link is on its way. Click it to finish signing up.`, link: back });
  });

  app.get<{ Params: { token: string } }>('/confirm/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const { result, list } = await confirmSignup(deps.db, hashToken(req.params.token), now());
    if (result === 'invalid') return reply.page('./notice', INVALID);
    if (result === 'confirmed' && list) deps.metrics?.confirmed(list);
    return reply.page('./notice', {
      title: 'Confirmed',
      heading: result === 'confirmed' ? "You're on the list" : 'You have already confirmed',
      message: result === 'confirmed' ? `You'll get one email when ${LIST_NAME[list as List]} are available.` : 'Nothing more to do. You are already confirmed.',
      back: true,
    });
  });

  app.get<{ Params: { token: string } }>('/unsubscribe/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const r = await unsubscribe(deps.db, hashToken(req.params.token), now());
    return r === 'ok'
      ? reply.page('./notice', { title: 'Unsubscribed', heading: "You're unsubscribed", message: 'You will not receive any more emails from this list.', back: true })
      : reply.page('./notice', INVALID);
  });
}
```

Register in `src/web/app.ts`: `import notifyRoutes from './routes/notify.js';` and `await app.register(notifyRoutes, deps);`.

The "already confirmed" heading reads "You have already confirmed", which the test matches via the substring `already confirmed`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/notify.test.ts tests/unit/mailer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat(notify): double opt-in lists for PDF and check pack, Resend mailer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Contact form (quote requests)

**Files:**
- Create: `src/web/form-time.ts`, `src/store/messages.ts`, `src/web/routes/contact.ts`, `views/contact.eta`
- Modify: `src/web/app.ts` (register the route)
- Test: `tests/unit/form-time.test.ts`, `tests/integration/contact.test.ts`

**Interfaces:**
- Consumes: `Mailer`, `consume`, `clientIp`, `REPORT_ID_RE`.
- Produces:
  - `issueFormTime(secret: string, now: Date): string`, `checkFormTime(secret: string, value: string | undefined, now: Date, minMs?: number, maxMs?: number): boolean`
  - `saveMessage(db, m: NewMessage): Promise<ObjectId>`, `markMessageSent(db, id: ObjectId): Promise<void>`
  - Routes `GET /contact` and `POST /contact`

- [ ] **Step 1: Write the failing tests**

`tests/unit/form-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkFormTime, issueFormTime } from '../../src/web/form-time.js';

describe('form time token', () => {
  const t0 = new Date('2026-10-12T10:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  it('accepts a form filled after 3 s and within a day', () => {
    const v = issueFormTime('secret-secret-secret', t0);
    expect(checkFormTime('secret-secret-secret', v, at(1_000))).toBe(false);
    expect(checkFormTime('secret-secret-secret', v, at(5_000))).toBe(true);
    expect(checkFormTime('secret-secret-secret', v, at(2 * 86_400_000))).toBe(false);
  });
  it('rejects forged or missing values', () => {
    expect(checkFormTime('secret-secret-secret', `${t0.getTime() - 60_000}.deadbeef`, t0)).toBe(false);
    expect(checkFormTime('secret-secret-secret', undefined, t0)).toBe(false);
    expect(checkFormTime('secret-secret-secret', 'garbage', t0)).toBe(false);
  });
});
```

`tests/integration/contact.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueFormTime } from '../../src/web/form-time.js';
import { testApp } from '../helpers/app.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const secret = 'dev-only-secret-change-me';
const valid = () => ({
  name: 'Ana', email: 'ana@client.test', company: 'Client Ltd', r: 'AAAAAAAAAAAAAAAAAAAAAA',
  message: 'Please quote the lodash and request upgrades for our API.', website: '',
  t: issueFormTime(secret, new Date(Date.now() - 10_000)), 'cf-turnstile-response': 'tok',
});
const post = (o: Record<string, string>, ip = '203.0.113.40') => t.app.inject({
  method: 'POST', url: '/contact', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
  payload: new URLSearchParams(o).toString(),
});

describe('contact', () => {
  it('renders the form with the report link prefilled', async () => {
    const res = await t.app.inject({ url: '/contact?r=AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.body).toContain('name="r" value="AAAAAAAAAAAAAAAAAAAAAA"');
    expect(res.body).toContain('name="website"');
    expect(res.body).not.toMatch(OWNER_NAME_RE);
  });

  it('stores the message and emails the owner with reply-to', async () => {
    const res = await post(valid());
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Thanks');
    const mail = t.mails.at(-1);
    expect(mail).toMatchObject({ to: 'owner@example.com', replyTo: 'ana@client.test', subject: 'Quote request: Ana (Client Ltd)' });
    expect(mail?.text).toContain('http://localhost:8080/r/AAAAAAAAAAAAAAAAAAAAAA');
    expect(await t.db.collection('messages').countDocuments({ emailSent: true })).toBe(1);
  });

  it('silently drops honeypot submissions', async () => {
    const before = t.mails.length;
    const res = await post({ ...valid(), website: 'http://spam.test' }, '203.0.113.41');
    expect(res.statusCode).toBe(200);
    expect(t.mails.length).toBe(before);
  });

  it('rejects too-fast forms, link spam and header injection', async () => {
    expect((await post({ ...valid(), t: issueFormTime(secret, new Date()) }, '203.0.113.42')).statusCode).toBe(400);
    const spam = 'see https://a.test https://b.test https://c.test https://d.test https://e.test https://f.test';
    expect((await post({ ...valid(), message: spam }, '203.0.113.42')).statusCode).toBe(400);
    await post({ ...valid(), name: 'Eve\r\nBcc: victim@x.test' }, '203.0.113.43');
    expect(t.mails.at(-1)?.subject).toBe('Quote request: Eve Bcc: victim@x.test (Client Ltd)');
  });

  it('limits to 3 messages per IP per day', async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(valid(), '198.51.100.50')).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
```

Run both. Expected: FAIL.

- [ ] **Step 2: Implement `src/web/form-time.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (secret: string, ms: string) => createHmac('sha256', secret).update(`form:${ms}`).digest('hex').slice(0, 32);

export function issueFormTime(secret: string, now: Date): string {
  const ms = String(now.getTime());
  return `${ms}.${sign(secret, ms)}`;
}

export function checkFormTime(secret: string, value: string | undefined, now: Date, minMs = 3_000, maxMs = 86_400_000): boolean {
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(value ?? '');
  if (!m) return false;
  const [, ms = '', mac = ''] = m;
  const expected = Buffer.from(sign(secret, ms));
  if (!timingSafeEqual(expected, Buffer.from(mac))) return false;
  const age = now.getTime() - Number(ms);
  return age >= minMs && age <= maxMs;
}
```

- [ ] **Step 3: Implement `src/store/messages.ts`**

```ts
import type { Db, ObjectId } from 'mongodb';

export interface NewMessage { name: string; email: string; company: string; message: string; reportId: string | null; createdAt: Date }

export async function saveMessage(db: Db, m: NewMessage): Promise<ObjectId> {
  const res = await db.collection('messages').insertOne({ ...m, emailSent: false });
  return res.insertedId;
}

export async function markMessageSent(db: Db, id: ObjectId): Promise<void> {
  await db.collection('messages').updateOne({ _id: id }, { $set: { emailSent: true } });
}
```

- [ ] **Step 4: Implement `src/web/routes/contact.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_ID_RE } from '../../store/ids.js';
import { markMessageSent, saveMessage } from '../../store/messages.js';
import type { AppDeps } from '../app.js';
import { clientIp } from '../client-ip.js';
import { checkFormTime, issueFormTime } from '../form-time.js';
import { consume } from '../limits.js';

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

const Body = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  company: z.string().trim().max(100).optional().default(''),
  message: z.string().trim().min(10).max(4000),
  r: z.string().optional().default(''),
  website: z.string().optional().default(''),
  t: z.string().optional(),
  'cf-turnstile-response': z.string().max(2048).optional(),
});

export default async function contactRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const now = () => (deps.clock ?? (() => new Date()))();
  const formPage = (r: string, status = 200, error?: string, values: Record<string, string> = {}) =>
    ({ template: './contact', data: { title: 'Get a quote', turnstile: true, r: REPORT_ID_RE.test(r) ? r : '', t: issueFormTime(deps.config.IP_HASH_SECRET, now()), error, values }, status });

  app.get<{ Querystring: { r?: string } }>('/contact', (req, reply) => {
    const p = formPage(String(req.query.r ?? ''));
    return reply.page(p.template, p.data, p.status);
  });

  app.post('/contact', async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    const raw = (req.body ?? {}) as Record<string, string>;
    const fail = (msg: string, status = 400) => {
      const p = formPage(String(raw.r ?? ''), status, msg, { name: raw.name ?? '', email: raw.email ?? '', company: raw.company ?? '', message: raw.message ?? '' });
      return reply.page(p.template, p.data, p.status);
    };
    if (!parsed.success) return fail('Please fill in your name, a valid email and a message of at least 10 characters.');
    const b = parsed.data;
    if (b.website) return reply.page('./notice', { title: 'Thanks', heading: 'Thanks, message received', message: "You'll get a reply by email, usually within two working days." });
    if (!checkFormTime(deps.config.IP_HASH_SECRET, b.t, now())) return fail('Please take a moment to fill in the form, then send it again.');
    if ((b.message.match(/https?:\/\//gi) ?? []).length > 5) return fail('Please include at most 5 links.');
    const ip = clientIp(req);
    if (!(await deps.turnstile.verify(b['cf-turnstile-response'], ip))) return fail('The bot check did not pass. Please wait for it to turn green.');
    if (!(await consume(deps, 'contact', ip, 3))) return fail('Too many messages from your network today. Please try again tomorrow.', 429);

    const reportId = REPORT_ID_RE.test(b.r) ? b.r : null;
    const name = oneLine(b.name), company = oneLine(b.company);
    const id = await saveMessage(deps.db, { name, email: b.email, company, message: b.message, reportId, createdAt: now() });
    try {
      await deps.mailer.send({
        to: deps.config.CONTACT_TO,
        replyTo: b.email,
        subject: `Quote request: ${name}${company ? ` (${company})` : ''}`,
        text: [
          `From: ${name} <${b.email}>${company ? `, ${company}` : ''}`,
          reportId ? `Report: ${deps.config.PUBLIC_URL}/r/${reportId}` : 'Report: none',
          '',
          b.message,
        ].join('\n'),
      });
      await markMessageSent(deps.db, id);
    } catch (err) {
      req.log.error({ err }, 'contact email failed; message kept in the database');
    }
    return reply.page('./notice', { title: 'Thanks', heading: 'Thanks, message received', message: "You'll get a reply by email, usually within two working days.", back: true });
  });
}
```

Register in `src/web/app.ts`: `import contactRoutes from './routes/contact.js';` and `await app.register(contactRoutes, deps);`.

- [ ] **Step 5: Create `views/contact.eta`**

```html
<% layout('./layout') %>
<form class="panel contact-form" method="post" action="/contact">
  <h1>Get a fixed-price quote</h1>
  <p class="muted">noticely is built by an independent backend engineer (Node.js, MongoDB, Docker, upgrades &amp; migrations). Describe what you need; you'll get a reply by email with a fixed price, usually within two working days.</p>
  <% if (it.error) { %><div class="banner"><%= it.error %></div><% } %>
  <label>Name <input type="text" name="name" required maxlength="100" value="<%= it.values.name || '' %>" autocomplete="name"></label>
  <label>Email <input type="email" name="email" required maxlength="254" value="<%= it.values.email || '' %>" autocomplete="email"></label>
  <label>Company <span class="muted">(optional)</span> <input type="text" name="company" maxlength="100" value="<%= it.values.company || '' %>" autocomplete="organization"></label>
  <label>What should be done? <textarea name="message" rows="7" required minlength="10" maxlength="4000"><%= it.values.message || '' %></textarea></label>
  <% if (it.r) { %><p class="muted small">Report attached: <a href="/r/<%= it.r %>">/r/<%= it.r %></a></p><% } %>
  <input type="hidden" name="r" value="<%= it.r %>">
  <input type="hidden" name="t" value="<%= it.t %>">
  <label class="hp" aria-hidden="true">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>
  <div class="cf-turnstile" data-sitekey="<%= it.siteKey %>"></div>
  <div class="row-actions"><button class="b p" type="submit">Send request</button></div>
  <p class="muted small">Your message is stored for up to 180 days and used only to reply to you. See <a href="/privacy">privacy</a>.</p>
</form>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/contact.test.ts tests/unit/form-time.test.ts`
Expected: PASS.

The header-injection test expects `Eve Bcc: victim@x.test`. `oneLine` turns the CR/LF into a single space, so the text can never become an email header. Resend's JSON API has no raw header lines in any case.

- [ ] **Step 7: Commit**

```bash
git add src views tests
git commit -m "feat(contact): quote request form with honeypot, time token, link limit, rate limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: Sample report, health, metrics and the process entry point

**Files:**
- Create: `src/metrics.ts`, `src/check/sample.ts`, `src/web/routes/ops.ts`, `src/main.ts`, `data/sample-package.json`
- Modify: `src/web/app.ts` (register the ops routes)
- Test: `tests/integration/ops.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `createMetrics(): { registry: Registry; app: AppMetrics; sources: SourceMetrics; checks: CheckMetrics }`
  - `ensureSample(db: Db, runner: CheckRunner, file: string, now: Date, maxAgeMs?: number): Promise<boolean>` (returns true when a rebuild was started)
  - Routes `GET /healthz`, `GET /metrics` and `GET /sample`

- [ ] **Step 1: Create the sample input**

`data/sample-package.json`:

```json
{
  "name": "acme-shop-api",
  "version": "3.4.0",
  "dependencies": {
    "lodash": "4.17.15",
    "request": "2.88.2",
    "node-uuid": "1.4.8",
    "left-pad": "1.3.0",
    "moment": "2.29.4",
    "mongoose": "6.12.0",
    "express": "5.1.0",
    "cors": "2.8.5",
    "dotenv": "16.4.5",
    "jsonwebtoken": "9.0.2",
    "helmet": "8.0.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "typescript": "5.4.5",
    "eslint": "8.57.0",
    "nodemon": "3.1.0",
    "jest": "29.7.0"
  }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/integration/ops.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSample } from '../../src/check/sample.js';
import { createMetrics } from '../../src/metrics.js';
import { getReport } from '../../src/store/reports.js';
import { testApp } from '../helpers/app.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ sources: fakeSources({ npm: { express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }) } }) }); });
afterAll(async () => t.close());

describe('ops', () => {
  it('reports health', async () => {
    const res = await t.app.inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('serves metrics', async () => {
    const res = await t.app.inject({ url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('deps_checks_total');
  });

  it('builds the sample once and rebuilds it when stale', async () => {
    const now = new Date();
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(true);
    await t.runner.idle();
    expect(await getReport(t.db, 'sample')).toMatchObject({ status: 'done', projectName: 'acme-shop-api' });
    expect((await getReport(t.db, 'sample'))?.expiresAt).toBeUndefined();
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', now)).toBe(false);
    expect(await ensureSample(t.db, t.runner, 'data/sample-package.json', new Date(now.getTime() + 25 * 3_600_000))).toBe(true);
    await t.runner.idle();
    const res = await t.app.inject({ url: '/sample' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/r/sample');
  });

  it('exposes Prometheus metrics with the expected names', async () => {
    const m = createMetrics();
    m.app.limited('check');
    m.app.confirmed('pdf');
    m.sources.request('npm', 'ok', 0.12);
    m.sources.cache(true);
    m.checks.finished('done', 1.5);
    const text = await m.registry.metrics();
    for (const name of ['deps_checks_total{result="done"} 1', 'deps_rate_limited_total{kind="check"} 1', 'deps_signups_confirmed_total{list="pdf"} 1',
      'deps_upstream_requests_total{source="npm",outcome="ok"} 1', 'deps_cache_lookups_total{result="hit"} 1']) {
      expect(text).toContain(name);
    }
  });
});
```

Run: `MONGO_URL=mongodb://localhost:27017 npx vitest run tests/integration/ops.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/metrics.ts`**

```ts
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { CheckMetrics } from './check/runner.js';
import type { SourceMetrics } from './sources/index.js';
import type { AppMetrics } from './web/app.js';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'deps_' });
  const checks = new Counter({ name: 'deps_checks_total', help: 'Finished checks', labelNames: ['result'], registers: [registry] });
  const checkDuration = new Histogram({ name: 'deps_check_duration_seconds', help: 'Check duration', buckets: [0.5, 1, 2, 5, 10, 20, 30], registers: [registry] });
  const limited = new Counter({ name: 'deps_rate_limited_total', help: 'Requests refused by a rate limit', labelNames: ['kind'], registers: [registry] });
  const signups = new Counter({ name: 'deps_signups_confirmed_total', help: 'Confirmed notify-me signups', labelNames: ['list'], registers: [registry] });
  const upstream = new Counter({ name: 'deps_upstream_requests_total', help: 'Upstream API requests', labelNames: ['source', 'outcome'], registers: [registry] });
  const upstreamDuration = new Histogram({ name: 'deps_upstream_duration_seconds', help: 'Upstream request duration', labelNames: ['source'], buckets: [0.1, 0.25, 0.5, 1, 2, 5], registers: [registry] });
  const cache = new Counter({ name: 'deps_cache_lookups_total', help: 'Cache lookups', labelNames: ['result'], registers: [registry] });

  const app: AppMetrics = {
    limited: (kind) => limited.inc({ kind }),
    confirmed: (list) => signups.inc({ list }),
    render: () => registry.metrics(),
  };
  const sources: SourceMetrics = {
    request: (source, outcome, seconds) => { upstream.inc({ source, outcome }); upstreamDuration.observe({ source }, seconds); },
    cache: (hit) => cache.inc({ result: hit ? 'hit' : 'miss' }),
  };
  const checkMetrics: CheckMetrics = {
    finished: (result, seconds) => { checks.inc({ result }); checkDuration.observe(seconds); },
  };
  return { registry, app, sources, checks: checkMetrics };
}
```

- [ ] **Step 4: Implement `src/check/sample.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Db } from 'mongodb';
import { parseInput } from '../analyze/parse.js';
import { getReport, upsertSampleReport } from '../store/reports.js';
import type { CheckRunner } from './runner.js';

export const SAMPLE_MAX_AGE_MS = 24 * 3_600_000;

export async function ensureSample(db: Db, runner: CheckRunner, file: string, now: Date, maxAgeMs = SAMPLE_MAX_AGE_MS): Promise<boolean> {
  const existing = await getReport(db, 'sample');
  if (existing && existing.status !== 'failed' && now.getTime() - existing.createdAt.getTime() < maxAgeMs) return false;
  const parsed = parseInput(readFileSync(file, 'utf8'), null);
  await upsertSampleReport(db, { projectName: parsed.projectName, hasLockfile: false, deps: parsed.deps, skipped: parsed.skipped }, now);
  return runner.submit('sample');
}
```

- [ ] **Step 5: Implement `src/web/routes/ops.ts` and register it**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

export default async function opsRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/healthz', async (_req, reply) => {
    try {
      await deps.db.command({ ping: 1 });
      return reply.type('text/plain').send('ok');
    } catch {
      return reply.code(503).type('text/plain').send('db unavailable');
    }
  });
  // Blocked at Caddy (404 from outside); reachable inside the server for Prometheus.
  app.get('/metrics', async (_req, reply) => reply.type('text/plain; version=0.0.4').send(await (deps.metrics?.render() ?? Promise.resolve(''))));
  app.get('/sample', (_req, reply) => reply.redirect('/r/sample', 302));
}
```

Register in `src/web/app.ts`: `import opsRoutes from './routes/ops.js';` and `await app.register(opsRoutes, deps);`.

- [ ] **Step 6: Implement `src/main.ts`**

```ts
import { CheckRunner } from './check/runner.js';
import { ensureSample } from './check/sample.js';
import { loadConfig } from './config.js';
import { createLogMailer, createResendMailer } from './mail/mailer.js';
import { createMetrics } from './metrics.js';
import { loadReplacements } from './analyze/replacements.js';
import { createSources } from './sources/index.js';
import { mongoCache, type CacheDoc } from './store/cache.js';
import { connect, ensureIndexes } from './store/db.js';
import { buildApp } from './web/app.js';
import { createTurnstile } from './web/turnstile.js';

const config = loadConfig();
const { client, db } = await connect(config.MONGO_URL, config.MONGO_DB);
await ensureIndexes(db);

const metrics = createMetrics();
const sources = createSources({
  fetch,
  cache: mongoCache(db.collection<CacheDoc>('packages')),
  advisoryCache: mongoCache(db.collection<CacheDoc>('advisories')),
  metrics: metrics.sources,
});
const runner = new CheckRunner({
  db, sources, replacements: loadReplacements('data/replacements.json'), metrics: metrics.checks,
  log: (msg, err) => console.error(msg, err instanceof Error ? err.message : ''),
});
const mailer = config.RESEND_API_KEY
  ? createResendMailer({ apiKey: config.RESEND_API_KEY, from: config.MAIL_FROM, fetch })
  : createLogMailer((line) => console.log(line));

const app = await buildApp({
  config, db, runner, mailer, metrics: metrics.app, logger: true,
  turnstile: createTurnstile({ secret: config.TURNSTILE_SECRET, fetch }),
});

const refreshSample = () => ensureSample(db, runner, 'data/sample-package.json', new Date())
  .catch((err) => app.log.error({ err }, 'sample report refresh failed'));
await refreshSample();
const timer = setInterval(refreshSample, 6 * 3_600_000);

await app.listen({ host: '0.0.0.0', port: config.PORT });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    clearInterval(timer);
    await app.close();
    await runner.idle();
    await client.close();
    process.exit(0);
  });
}
```

- [ ] **Step 7: Run all tests, then smoke-test locally**

Run: `make check`
Expected: lint, typecheck and every test pass.

Then:

```bash
npm run dev
# in another terminal:
curl -s localhost:8080/healthz          # ok
curl -sI localhost:8080/sample          # 302 Location: /r/sample
```

Open `http://localhost:8080/r/sample` in a browser. It should show the real sample report: lodash Critical/High, request and node-uuid deprecated, left-pad single maintainer, mongoose 2 majors behind. Then open `http://localhost:8080/`, paste the sample `package.json` and submit. The Turnstile test keys always pass. The redirect should go to a progress page, which then becomes a report. Check the light/dark toggle and the dev-dependencies tab.

- [ ] **Step 8: Commit**

```bash
git add src data tests
git commit -m "feat: sample report, health and Prometheus metrics, process entry point

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 16: Container image, CI, self-check, Renovate and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `renovate.json`, `scripts/selfcheck.ts`, `scripts/smoke.sh`, `README.md`
- Create: `deploy/docker-compose.yml`, `deploy/env.example`, `deploy/deps.caddy`, `deploy/deps-mongo-dump.sh`

**Interfaces:**
- Consumes: `parseInput`, `analyzeDeps`, `createSources`, `memoryCache`, `loadReplacements`.
- Produces:
  - the image `ghcr.io/noticely-dev/deps:{sha}` / `:latest` (linux/arm64), listening on port 8080, running as user `node`;
  - `npm run selfcheck`, which exits 1 when any dependency of this repo is Critical or High.

- [ ] **Step 1: Write the self-check script**

`scripts/selfcheck.ts`:

```ts
// Dogfooding: run the analysis on this repository's own package.json + lockfile (live upstream data).
import { readFileSync } from 'node:fs';
import { parseInput } from '../src/analyze/parse.js';
import { loadReplacements } from '../src/analyze/replacements.js';
import { analyzeDeps } from '../src/check/analyze-deps.js';
import { createSources } from '../src/sources/index.js';
import { memoryCache } from '../src/store/cache.js';

const input = parseInput(readFileSync('package.json', 'utf8'), readFileSync('package-lock.json', 'utf8'));
const sources = createSources({ fetch, cache: memoryCache(), advisoryCache: memoryCache() });
const result = await analyzeDeps(input, sources, loadReplacements('data/replacements.json'), new Date(), AbortSignal.timeout(60_000));

console.log(`Self-check: score ${result.score}/100 (${result.label}) — ${result.summary}`);
for (const p of result.packages.filter((x) => x.risk !== 'healthy')) {
  console.log(`  ${p.risk.padEnd(8)} ${p.scope.padEnd(4)} ${p.name}@${p.resolved}: ${p.findings.map((f) => f.text).join('; ')}`);
}
if (result.partial.length) console.log(`  (partial data: ${result.partial.join(', ')})`);
const blocking = result.packages.filter((p) => p.risk === 'critical' || p.risk === 'high');
if (blocking.length) {
  console.error(`Self-check failed: ${blocking.map((p) => p.name).join(', ')}`);
  process.exit(1);
}
```

Run: `npm run selfcheck`
Expected: prints the score and exits 0. If it flags a package as High, upgrade it (or replace it) before continuing. That is the point of the check.

- [ ] **Step 2: Dockerfile and .dockerignore**

`Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY views ./views
COPY public ./public
COPY data ./data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/src/main.js"]
```

`.dockerignore`:

```
node_modules
dist
.git
.superpowers
docs
tests
coverage
.env
deploy
```

Run: `docker build -t deps:local .`
Expected: the build succeeds. Then smoke-test it against the local test MongoDB:

```bash
docker run --rm -d --name deps-local --network host -e NODE_ENV=development -e MONGO_URL=mongodb://localhost:27017 deps:local
sleep 3 && curl -s localhost:8080/healthz && docker stop deps-local
```

Expected: `ok`.

- [ ] **Step 3: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    services:
      mongo:
        image: mongo:8.0
        ports: ['27017:27017']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
        env:
          MONGO_URL: mongodb://localhost:27017
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run selfcheck

  image:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04-arm
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/arm64
          tags: |
            ghcr.io/noticely-dev/deps:${{ github.sha }}
            ghcr.io/noticely-dev/deps:latest
```

`ubuntu-24.04-arm` is GitHub's native arm64 runner, which is free for public repositories. If it is unavailable, use `ubuntu-24.04` plus `docker/setup-qemu-action@v3` before the build step.

- [ ] **Step 4: Renovate config**

`renovate.json`:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "schedule": ["before 6am on monday"],
  "minimumReleaseAge": "14 days",
  "packageRules": [
    { "matchUpdateTypes": ["minor", "patch"], "groupName": "minor and patch updates" },
    { "matchDatasources": ["docker"], "matchPackageNames": ["mongo"], "allowedVersions": "<8.1" }
  ]
}
```

- [ ] **Step 5: Deployment files**

`deploy/docker-compose.yml`:

```yaml
services:
  web:
    image: ghcr.io/noticely-dev/deps:${TAG:-latest}
    container_name: deps-web
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      MONGO_URL: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@deps-mongo:27017/?authSource=admin
    read_only: true
    tmpfs: [/tmp]
    security_opt: ['no-new-privileges:true']
    cap_drop: [ALL]
    mem_limit: 512m
    depends_on: [mongo]
    networks: [web, internal]

  mongo:
    image: mongo:8.0
    container_name: deps-mongo
    restart: unless-stopped
    command: ['--wiredTigerCacheSizeGB', '0.25']
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes: ['mongo-data:/data/db']
    security_opt: ['no-new-privileges:true']
    mem_limit: 1g
    networks: [internal]

volumes:
  mongo-data:

networks:
  web:
    external: true
  internal:
    name: deps-internal
    internal: true
```

MongoDB's entrypoint needs to switch users at startup, so it keeps its default capabilities. It is still unreachable from outside, because `internal: true` gives it no route out.

`deploy/env.example`:

```
# /srv/deps/.env  (chmod 600) — never commit the real file
PUBLIC_URL=https://deps.noticely.dev
MONGO_USER=deps
MONGO_PASSWORD=<openssl rand -hex 24>
IP_HASH_SECRET=<openssl rand -hex 32>
TURNSTILE_SITE_KEY=<from Cloudflare Turnstile>
TURNSTILE_SECRET=<from Cloudflare Turnstile>
RESEND_API_KEY=<from Resend>
MAIL_FROM=noticely <hello@noticely.dev>
CONTACT_TO=<owner's inbox>
```

`deploy/deps.caddy`:

```
deps.noticely.dev {
	import cf_tls
	import common
	@internal path /metrics /metrics/*
	respond @internal "Not found" 404
	reverse_proxy deps-web:8080
}
```

`deploy/deps-mongo-dump.sh`:

```sh
#!/usr/bin/env bash
# restic pre-hook: dump the deps MongoDB into /var/backups/dumps before the nightly backup.
set -euo pipefail
set -a; . /srv/deps/.env; set +a
docker exec deps-mongo mongodump --quiet --username "$MONGO_USER" --password "$MONGO_PASSWORD" \
  --authenticationDatabase admin --db deps --archive --gzip > /var/backups/dumps/deps-mongo.archive.gz.tmp
mv /var/backups/dumps/deps-mongo.archive.gz.tmp /var/backups/dumps/deps-mongo.archive.gz
```

`scripts/smoke.sh`:

```sh
#!/usr/bin/env bash
# Post-deploy smoke test: health endpoint and the sample report page.
set -euo pipefail
BASE="${1:-https://deps.noticely.dev}"
for i in $(seq 1 20); do
  [ "$(curl -fsS "$BASE/healthz" 2>/dev/null || true)" = "ok" ] && break
  sleep 3
done
[ "$(curl -fsS "$BASE/healthz")" = "ok" ] || { echo "healthz failed"; exit 1; }
curl -fsSL "$BASE/sample" | grep -q 'class="ring"' || { echo "sample report missing score ring"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")" = "404" ] || { echo "/metrics must not be public"; exit 1; }
echo "smoke ok: $BASE"
```

```bash
chmod +x scripts/smoke.sh deploy/deps-mongo-dump.sh
```

- [ ] **Step 6: README**

`README.md`:

```markdown
<p align="center"><img src="public/brand/noticely-wordmark-light.png" alt="noticely" width="320"></p>

# noticely/deps

Free dependency health check for npm projects: **https://deps.noticely.dev**

Paste a `package.json` (optionally with `package-lock.json`) and get a report of vulnerable, deprecated,
abandoned, single-maintainer and outdated dependencies, a health score, and an upgrade plan ordered by risk
removed per hour, with rough effort estimates.

- Data: npm registry, npm downloads, [OSV.dev](https://osv.dev), [deps.dev](https://deps.dev) / OpenSSF Scorecard
- Rules and scoring: see [/methodology](https://deps.noticely.dev/methodology)
- Privacy: only dependency names and versions are stored, for 30 days

## Run locally

    make db-up          # MongoDB in Docker on :27017
    npm ci
    npm run dev         # http://localhost:8080 (Turnstile test keys, emails printed to the console)

## Test

    make check          # lint + typecheck + unit and integration tests
    npm run selfcheck   # the tool checks its own dependencies

## Stack

TypeScript · Node.js 24 · Fastify 5 · Eta · MongoDB 8 · Docker · GitHub Actions. Design: `docs/superpowers/specs/`.

## License

MIT
```

- [ ] **Step 7: Verify and commit**

Run: `make check && npm run selfcheck && docker build -t deps:local .`
Expected: all pass.

```bash
git add -A
git commit -m "build: Docker image, CI with arm64 image push, self-check, Renovate, deploy files, README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 17: Accounts, DNS, server setup and first deploy

This task is mostly operations. Steps marked **(owner)** need the owner in a browser, because they involve account creation, API keys or DNS. The agent gives instructions and verifies; it never handles the secret values in chat.

**Files:**
- Server only: `/srv/deps/{docker-compose.yml,.env}`, `/srv/caddy/sites/deps.caddy`, `/etc/restic/pre.d/deps-mongo-dump.sh`

**Interfaces:**
- Consumes: the GHCR image from Task 16, plus the existing Caddy (`/srv/caddy`, network `web`, snippets `cf_tls`/`common`) and restic setup on `app-1`.
- Produces: `https://deps.noticely.dev`, live.

- [ ] **Step 1: Publish the repo and the first image**

```bash
cd ~/noticely/deps
gh repo create noticely-dev/deps --public --source . --push --description "Free dependency health check for npm projects"
gh run watch --repo noticely-dev/deps --exit-status
```

Expected: the `test` and `image` jobs both pass.

**(owner)** Make the image public, so `app-1` can pull it without credentials: GitHub → noticely-dev → Packages → `deps` → Package settings → Change visibility → Public.

Verify: `docker manifest inspect ghcr.io/noticely-dev/deps:latest | grep -c arm64` prints at least `1`.

- [ ] **Step 2: (owner) Cloudflare Turnstile widget**

1. Cloudflare dashboard → Turnstile → Add widget.
2. Name it `deps.noticely.dev`, with hostname `deps.noticely.dev`, mode **Managed**.
3. Keep the **site key** and **secret key** for Step 6. Don't paste them into chat.

- [ ] **Step 3: (owner) Email: Cloudflare Email Routing and Resend**

1. Cloudflare → noticely.dev → **Email → Email Routing** → enable it.
   - Cloudflare offers to add its MX and SPF records. Accept, and let it **replace** the root `v=spf1 -all` TXT record.
   - Add the custom address `hello@noticely.dev` → the owner's Gmail, and confirm the verification email.
2. Resend (resend.com): create an account and **add the domain `noticely.dev`**.
   - Add the DNS records Resend shows in Cloudflare, all **DNS only** (grey cloud): DKIM, plus the SPF and MX records on Resend's sending subdomain.
   - Wait for "Verified".
3. Resend: create an API key with **Sending access** only, scoped to `noticely.dev`. Keep it for Step 6.
4. Keep the `_dmarc` record `v=DMARC1; p=reject;`. Resend signs with DKIM on `noticely.dev`, which satisfies DMARC alignment.
5. Optional: in Gmail → Settings → Accounts → "Send mail as", add `hello@noticely.dev` using Resend's SMTP (`smtp.resend.com`, user `resend`, the API key as password). Replies then come from the brand address.

Verify (agent): `dig +short TXT noticely.dev` shows exactly one SPF record, and it includes `_spf.mx.cloudflare.net`. `dig +short MX noticely.dev` shows Cloudflare's routing MX hosts.

- [ ] **Step 4: (owner) Cloudflare rate-limiting rule**

Cloudflare → noticely.dev → **Security → WAF → Rate limiting rules** → Create rule:
- **If:** hostname equals `deps.noticely.dev` AND request method equals `POST`.
- **When rate exceeds:** 30 requests per 1 minute, counted per IP.
- **Then:** Block for 1 minute.

The free plan allows one rule, and this is it.

- [ ] **Step 5: Server directories and files (agent, over SSH)**

```bash
ssh app-1 'sudo install -d -o "$USER" -g "$USER" -m 750 /srv/deps'
scp deploy/docker-compose.yml app-1:/srv/deps/docker-compose.yml
scp deploy/deps.caddy app-1:/tmp/deps.caddy && ssh app-1 'sudo install -m 644 /tmp/deps.caddy /srv/caddy/sites/deps.caddy && rm /tmp/deps.caddy'
scp deploy/deps-mongo-dump.sh app-1:/tmp/ && ssh app-1 'sudo install -m 750 /tmp/deps-mongo-dump.sh /etc/restic/pre.d/deps-mongo-dump.sh && rm /tmp/deps-mongo-dump.sh'
ssh app-1 'umask 077; cat > /srv/deps/.env <<EOF
PUBLIC_URL=https://deps.noticely.dev
MONGO_USER=deps
MONGO_PASSWORD=$(openssl rand -hex 24)
IP_HASH_SECRET=$(openssl rand -hex 32)
MAIL_FROM=noticely <hello@noticely.dev>
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET=
RESEND_API_KEY=
CONTACT_TO=
EOF
ls -l /srv/deps'
```

Expected: `.env` exists with mode `-rw-------`, owned by the deploy user. The random secrets are generated on the server and never printed.

- [ ] **Step 6: (owner) Fill in the four secrets**

The owner runs, in their own terminal:

```bash
ssh -t app-1 'nano /srv/deps/.env'
```

Fill in `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`, `RESEND_API_KEY` and `CONTACT_TO` (the owner's Gmail), then save.

Verify (agent, without revealing values):
`ssh app-1 'grep -cE "^(TURNSTILE_SITE_KEY|TURNSTILE_SECRET|RESEND_API_KEY|CONTACT_TO)=.+" /srv/deps/.env'` prints `4`.

- [ ] **Step 7: Start the containers, then reload Caddy**

```bash
ssh app-1 'cd /srv/deps && docker compose pull && docker compose up -d && sleep 8 && docker compose ps'
ssh app-1 'cd /srv/caddy && docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile'
```

Expected:
- `deps-web` is `Up (healthy)` and `deps-mongo` is `Up`.
- Caddy prints `Valid configuration`, and the reload exits 0.
- If `deps-web` restarts in a loop, check `docker logs deps-web`. A "Production config incomplete" message names the missing variable.

- [ ] **Step 8: Smoke test from outside, and the backup hook**

```bash
./scripts/smoke.sh https://deps.noticely.dev
ssh app-1 'sudo /etc/restic/pre.d/deps-mongo-dump.sh && ls -l /var/backups/dumps/'
```

Expected: `smoke ok: https://deps.noticely.dev`, and `deps-mongo.archive.gz` exists with a non-zero size. Tonight's 03:00 restic run includes the dump automatically, since it runs every executable in `pre.d`.

- [ ] **Step 9: End-to-end checks against the done criteria (agent + owner)**

- [ ] Open `https://deps.noticely.dev`, paste `data/sample-package.json`, and submit. The report appears within 30 s.
- [ ] `https://deps.noticely.dev/sample` and `/methodology` load, in both themes.
- [ ] **(owner)** Send the contact form from a report. The email arrives in Gmail from `hello@noticely.dev`, and Reply goes to the visitor's address.
- [ ] **(owner)** Sign up to the PDF list with a personal address: the confirmation email arrives and the link confirms. Do the same for the check-pack list from the limit page, by running 6 checks. Then click unsubscribe and verify it works.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://deps.noticely.dev/metrics` prints `404`.
- [ ] CI is green on `main`.

- [ ] **Step 10: (owner) External uptime check**

Create a free HTTP monitor for `https://deps.noticely.dev/healthz`, expecting keyword `ok`, every 5 minutes, with email alerts. A good choice is the provider already used for other sites. Check the provider's current free-tier terms before signing up.

- [ ] **Step 11: Wrap up**

- Add a "Deployment" section to `README.md` that links `deploy/`, and commit.
- Update `~/.claude` memory: project O is live, with the deploy command `make deploy [TAG=sha]` and the pending demand signals (notify-me signups per list).
