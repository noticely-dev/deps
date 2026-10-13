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
