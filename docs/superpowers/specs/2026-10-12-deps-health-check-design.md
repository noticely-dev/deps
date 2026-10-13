# noticely/deps — Dependency Health Check (v1) — Design

**Status:** draft for review · **Date:** 2026-10-12 · **Repo:** `github.com/noticely-dev/deps` (public, MIT)
**Live URL:** `https://deps.noticely.dev`

## 1. Purpose and success criteria

A free public tool: a visitor pastes or uploads a `package.json` (optionally with `package-lock.json`) and gets a
professional report showing which dependencies are **vulnerable, deprecated, abandoned, single-maintainer or far
behind**, with a prioritised upgrade plan and rough effort estimates.

Goals:

- **Portfolio / lead generation.** The report demonstrates expertise; a contact form turns readers into upgrade
  jobs. The owner's name is **not** shown anywhere; the site speaks as "an independent backend engineer" (one
  person; never "we").
- **Demand test for paid products** without building payments: "notify me" lists for a paid **PDF report** and a
  **check pack** (more checks per day).
- **Low upkeep:** ~1–2 hours/month.

Done means:

- `https://deps.noticely.dev` is live.
- A stranger can paste a `package.json` and get a correct, polished report in under 30 s.
- The sample report and the methodology page are online.
- The contact form reaches the owner's inbox.
- Both notify-me lists work with double opt-in.
- CI is green.

## 2. Scope

**In v1**

- Input: `package.json` (required) + `package-lock.json` npm lockfile v2/v3 (optional).
- `dependencies` and `devDependencies` (dev shown in a separate tab, half weight in score).
- One-off checks; shareable report link; Markdown and JSON export.
- 5 free checks per visitor per day; contact form; two notify-me lists (`pdf`, `pack`).

**Not in v1** (explicitly deferred)

- Payments.
- Transitive dependencies.
- yarn/pnpm lockfiles.
- GitHub repo URL input and README badge.
- Watch/weekly emails.
- Other ecosystems.
- User accounts.

## 3. Architecture

- **Runtime:** TypeScript on Node.js 24 LTS, Fastify, server-rendered HTML with a template engine that
  auto-escapes, minimal vanilla JS (progressive enhancement; core flows work without JS).
- **Database:** MongoDB 8.0.
- **Deployment on `app-1`** (Hetzner CAX21, arm64, Docker), directory `/srv/deps/`:
  - `deps-web` — the app; joins the external Docker network `web` so Caddy can reach it.
  - `deps-mongo` — `mongo:8.0`, on a private network `deps-internal` shared only with `deps-web`; authentication
    enabled; data in a named volume; never published to the host.
- **Edge:** Cloudflare (proxied DNS, Full strict) → Caddy (`/srv/caddy/sites/deps.caddy`, origin certificate,
  `import cf_tls`, `import common`) → `deps-web:8080`. Caddy blocks `/metrics` (404); `/healthz` is public and returns only `ok`.
- **External services (free tiers):** Resend (send email), Cloudflare Email Routing (`hello@noticely.dev` → owner's
  Gmail), Cloudflare Turnstile (bot protection), one Cloudflare rate-limiting rule.

### Code modules

| Module | Responsibility | Depends on |
|---|---|---|
| `src/sources/` | One client per upstream: npm registry, npm downloads, OSV, deps.dev. Each client handles caching (via `store`), timeouts (5 s), retries (2, with backoff), and concurrency limits. Each returns typed, minimal data. | `store` |
| `src/analyze/` | **Pure** functions: parse inputs, resolve versions, apply rules, compute score, build upgrade plan, render summary text. No I/O. | — |
| `src/store/` | MongoDB repositories for every collection in §6; creates indexes on startup. | MongoDB |
| `src/web/` | Routes, input validation, Turnstile verification, rate limiting, templates, security headers. | all |
| `src/mail/` | Contact-message and confirmation emails via Resend. | Resend |
| `data/replacements.json` | Hand-maintained map of well-known deprecated packages → suggested replacements + effort class. | — |

## 4. How a check works

1. **Input.**
   - Limits: `package.json` ≤ 256 KB; lockfile ≤ 10 MB; ≤ 300 direct dependencies in total.
   - Input arrives as a textarea paste or a file upload (multipart).
   - JSON is parsed with a safe parser that rejects `__proto__`/`constructor` keys and nesting deeper than 64 levels.
2. **Validation of each dependency.**
   - The name must match npm's package-name rules (≤ 214 chars).
   - The spec must be ≤ 256 chars.
   - Not checked, listed with a reason: `git+`, `github:`, `file:`, `link:`, `workspace:`, URL, and `npm:` alias
     specs.
3. **Version resolution.**
   - With a lockfile: the exact version from `packages["node_modules/<name>"]`.
   - Without a lockfile: the **lowest** published version satisfying the range (worst case). Findings carry the
     note "may already be fixed — add your lockfile".
   - Packages not found on public npm are reported as "not on public npm (private packages aren't checked)".
4. **Data fetch.** Parallel, with a concurrency of 8, through the 24 h cache.
   - **npm registry packument:** `deprecated` (latest and resolved version), `time`, `maintainers`,
     `dist-tags.latest`, `repository`. Only the extracted fields are stored, never the full packument.
   - **npm downloads:** last-week downloads. Bulk endpoint for unscoped packages; one request per scoped package.
   - **OSV:** `querybatch` by name + resolved version. Advisory details (severity, summary, first fixed version)
     are fetched per ID and cached 7 days.
   - **deps.dev v3:** package → source project → OpenSSF Scorecard score and stars.
   - If a source fails, the report still completes. The affected column shows "unavailable" and a banner notes
     partial data. The score excludes the missing signals and says so.
5. **Rules → findings.** A package's risk is its worst finding.

   | Finding | Risk |
   |---|---|
   | Vulnerability | Advisory severity: CRITICAL → Critical, HIGH → High, MODERATE → Medium, LOW → Low; unknown → Medium |
   | Whole package deprecated (latest version deprecated) | High |
   | Only the resolved version deprecated | Medium |
   | No release for > 2 years | Medium |
   | Single npm maintainer | Low (Medium if also > 2 years idle) |
   | 1–2 majors behind latest | Low |
   | ≥ 3 majors behind latest | Medium |
   | None of the above | Healthy |

6. **Health score.**
   - Start at 100. Per package, subtract: Critical −25, High −12, Medium −5, Low −1. Dev dependencies count ×0.5.
   - The score is clamped to 0–100 and rounded.
   - Labels: 85–100 *Healthy*, 60–84 *Needs attention*, < 60 *At risk*.
   - All rules and numbers are published on `/methodology`.
7. **Upgrade plan.**
   - One step per package with risk ≥ Low.
   - Ordered by (risk points removed) ÷ (estimated hours); ties break toward the higher risk.
   - Effort classes (shown as ranges, labelled "rough estimate"):

     | Change | Estimate |
     |---|---|
     | Patch or minor upgrade | ~15 min |
     | Rename (e.g. `node-uuid` → `uuid`) | ~30 min |
     | Major upgrade | 0.5–1 day, +0.5 day per additional major |
     | Replace a deprecated package | 0.5–1 day |

   - `replacements.json` can override both the class and the suggestion.
   - The plan shows a total range.
8. **Summary paragraph.**
   - Generated from templates using the counts and the plan, e.g. "1 critical vulnerability with a one-line fix, 2
     packages abandoned by their authors … about 1–1.5 developer days."
   - Never includes unescaped upstream text.

Execution model: `POST /check` validates, rate-limits, stores a `reports` document (`status: running`) and redirects
to `/r/{id}`. The analysis runs in-process with a global concurrency cap (4 concurrent checks; extra requests wait
in a queue of up to 20, then get "busy, try again in a minute"), and each check has a 30 s timeout. While the report
is running, `/r/{id}` shows progress: it polls `/r/{id}/status` with JS, or uses a meta refresh without JS.

## 5. Pages and UI

Visual reference: `docs/design/report-layout-mockup.html`, **option A (executive dashboard)**. Option C in the same
file is not used. The site supports dark and light themes (follows `prefers-color-scheme`; a manual toggle is stored
in `localStorage`). Brand: the "n + ping-dot" logo, accent `#3b82f6`; assets in `public/brand/` (copied from
`~/noticely/brand/`).

| URL | Content |
|---|---|
| `/` | Hero, input (paste or drag-drop `package.json` + optional lockfile), "See a sample report", 3-step how-it-works, trust strip (data sources, privacy, open source) |
| `/r/{id}` | Report (layout A): see the elements listed below this table |
| `/r/{id}.md`, `/r/{id}.json` | Exports |
| `/sample` | Redirect to the permanent sample report, built from `data/sample-package.json` at startup and rebuilt daily so it stays current |
| `/methodology`, `/privacy` | Static content |
| `/contact` | Quote request form (`?r={id}` pre-fills report link) |
| `/confirm/{token}`, `/unsubscribe/{token}` | Notify-me flows |
| `/healthz` | Public; returns `ok` (200) when the app and MongoDB respond |
| `/metrics` | Internal only (Prometheus format); blocked at Caddy |

The report page (layout A) contains:

- A header with the project name, dependency count, check time and Copy link.
- A summary panel with the score ring, label, summary paragraph and 4 KPIs (vulnerabilities, deprecated,
  maintenance risk, majors behind).
- The dependency table, sorted by risk, with these columns: package and reason, in use → latest, last release,
  maintainers, weekly downloads, Scorecard, risk.
- Filters (Vulnerable / Deprecated / Maintenance) and expandable rows showing advisory IDs and fix versions.
- Dependencies / devDependencies tabs.
- A sidebar with:
  - the upgrade order, with estimates and a total;
  - the brand expert card: "Need these upgrades done? noticely is built by an independent backend engineer —
    Node.js, MongoDB, Docker, upgrades & migrations. Fixed price, tested, with a written handover." →
    `/contact?r={id}`;
  - the "Full PDF report — coming soon" box with an email field → `pdf` list.
- A footer with the data sources, "reports deleted after 30 days", and "open source · MIT".

Rate-limit page: "You've used today's 5 free checks. A check pack (100 checks, €9) is coming. Leave your email and
we'll tell you when it's available." → `pack` list. Viewing existing reports is never limited.

## 6. Data model (MongoDB)

| Collection | Key fields | Retention (TTL index) |
|---|---|---|
| `reports` | `_id` (128-bit random, base62), `status` (running/done/failed), `projectName`, `hasLockfile`, `deps[]` (name, spec, resolved, scope), `result` (score, label, summary, packages, plan, partial), `createdAt`, `expiresAt` | 30 days via `expiresAt`; the sample report has no `expiresAt` |
| `packages` | `_id` = name, extracted npm fields, downloads, deps.dev fields, `fetchedAt` | 24 h |
| `advisories` | `_id` = OSV id, severity, summary, fixed versions, `fetchedAt` | 7 days |
| `ratelimits` | `_id` = `{kind}:{ipHash}:{yyyy-mm-dd}` or `global:{day}`, `count` | 48 h |
| `subscribers` | `email` (lowercased), `list` (pdf/pack), `status` (pending/confirmed/unsubscribed), `tokenHash` (SHA-256), timestamps; unique (`email`, `list`) | Until unsubscribed (unsubscribed records purged after 30 days); pending records 7 days |
| `messages` | Contact form fields, `reportId`, `createdAt`, `emailSent` | 180 days |

Stored input is **only** dependency names, specs and resolved versions; never the whole file, scripts or other
fields. `ipHash` = HMAC-SHA256(secret, IP) and is used only for rate limiting.

## 7. Security and abuse protection

**Bot and spam protection**

- **Turnstile** on check, contact and both notify-me forms. Verified server-side; on failure, the form is shown
  again with an error.
- **Rate limits:**
  - Checks: 5/day per IP; global cap 500/day.
  - Contact: 3/day per IP.
  - Notify-me: 5/day per IP.
  - Outer layer: 1 Cloudflare rate-limiting rule (e.g. 30 POSTs/min per IP).
  - The IP comes from `CF-Connecting-IP`, trusted only via Caddy's Cloudflare `trusted_proxies`.
- **Contact form:**
  - Messages go only to the owner; there is no "copy to me" option.
  - Honeypot field; minimum 3 s fill time.
  - Limits: name ≤ 100 chars, message ≤ 4,000 chars, ≤ 5 links.
  - The email is validated; `reply-to` is set to the visitor's address.
- **Notify-me:** double opt-in. Only confirmed addresses count. Every email has an unsubscribe link. Consent text is
  shown next to the field.

**Input and output safety**

- Every route has a strict schema (exact fields, types and lengths); unknown fields are rejected.
- Database queries never interpolate user objects; values are scalar only.
- Templates auto-escape all output. No `innerHTML` with dynamic data.
- Upstream text (deprecation messages, advisory summaries) is treated as untrusted: escaped, and only `https:`
  links are rendered (`rel="nofollow noopener noreferrer"`).
- **Headers:**
  - Strict CSP: `default-src 'self'`, scripts `'self'` + Turnstile, no inline scripts (a nonce if unavoidable),
    `frame-ancestors 'none'`.
  - `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`.
  - HSTS is already sent by Caddy.
- The server never fetches visitor-supplied URLs. Upstream URLs are built only from validated, URL-encoded package
  names.
- Request body limits (11 MB total) and per-check/upstream timeouts (§4).

**Infrastructure and process**

- **Containers:** non-root user, read-only root filesystem (+ tmpfs `/tmp`), `no-new-privileges`, all capabilities
  dropped, memory limits (web 512 MB, mongo 1 GB).
- **Secrets:** in `/srv/deps/.env` (mode 600), never in git. Covers the MongoDB credentials, `RESEND_API_KEY`,
  `TURNSTILE_SECRET`, and `IP_HASH_SECRET`.
- **Own supply chain:** `npm audit` in CI; the app checks its own `package.json` in CI and fails on Critical/High;
  Renovate PRs weekly.
- **Logs:** never contain file contents, emails or raw IPs.

## 8. Email and DNS

Sender: `noticely <hello@noticely.dev>` via Resend.

| Change | Done by |
|---|---|
| Enable Cloudflare Email Routing: `hello@noticely.dev` → owner's Gmail (adds MX and SPF records) | owner, Cloudflare dashboard |
| Add the Resend domain verification records (DKIM, and SPF/MX on Resend's sending subdomain) | owner, values from Resend |
| Replace the root TXT `v=spf1 -all` with the SPF that Email Routing requires; keep `_dmarc` `p=reject` (Resend's DKIM aligns with `noticely.dev`) | owner, Cloudflare |
| Gmail "Send mail as" `hello@noticely.dev` (via Resend SMTP) so replies come from the brand address | owner, optional |

## 9. Testing

- **Unit (`analyze/`, validation):**
  - Rules, version resolution (lockfile and range-min), score, plan ordering, summary text.
  - Malicious inputs: `__proto__`, `<script>` in names/messages, oversized/deep JSON, invalid names, pathological
    ranges.
- **Sources:** tests run against recorded real responses (fixtures) from npm, OSV and deps.dev. No live network in
  CI.
- **Integration:** against a real `mongo:8.0` container (CI service), covering:
  - full check flow;
  - rate limits (per IP and global);
  - TTL indexes present;
  - double opt-in and unsubscribe;
  - contact form, with Resend mocked;
  - Turnstile verification, with a test secret.
- **Smoke (post-deploy):** request `/healthz` through the container, then load `https://deps.noticely.dev/sample`
  and assert that the score ring is present.

## 10. Delivery and operations

- **CI (GitHub Actions, every push/PR):**
  - Type-check, lint, unit and integration tests, `npm audit`, and the self-check.
  - On `main`: build an arm64 image and push `ghcr.io/noticely-dev/deps:{sha}` and `:latest`.
- **Deploy:** `make deploy [TAG=sha]` from the laptop. It SSHes to `app-1`, sets the tag, runs
  `docker compose pull && up -d`, and runs the smoke test. Rollback means deploying the previous SHA.
- **One-time server setup:**
  - `/srv/deps/{docker-compose.yml,.env}` and `/srv/caddy/sites/deps.caddy`, then a Caddy reload.
  - `/etc/restic/pre.d/deps-mongo.sh`: `mongodump --archive --gzip` into `/var/backups/dumps/deps-mongo.archive.gz`.
- **Metrics:** checks per day, rate-limit hits, upstream errors and latency per source, cache hit ratio, signups per
  list (confirmed), check duration.
- **Uptime:** a free external check on `https://deps.noticely.dev/healthz`, with email alerts.
- **Upkeep:** merge Renovate PRs; occasionally extend `replacements.json`.

## 11. Open questions

None blocking. To decide during implementation: the template engine and validation library (any choice meeting §7),
and the external uptime-check provider.
