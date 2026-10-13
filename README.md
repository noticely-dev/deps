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
