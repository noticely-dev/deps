import { CheckRunner } from './check/runner.js';
import { ensureSample } from './check/sample.js';
import { loadConfig } from './config.js';
import { createLogMailer, createResendMailer } from './mail/mailer.js';
import { createMetrics } from './metrics.js';
import { loadReplacements } from './analyze/replacements.js';
import { createSources } from './sources/index.js';
import { mongoCache, type CacheDoc } from './store/cache.js';
import { connect, ensureIndexes } from './store/db.js';
import { failRunningReports } from './store/reports.js';
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
  turnstile: createTurnstile({ secret: config.TURNSTILE_SECRET, fetch, log: (msg) => console.warn(msg) }),
});

// Single process: checks never survive a restart, so anything still running was lost.
await failRunningReports(db, new Date());
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
