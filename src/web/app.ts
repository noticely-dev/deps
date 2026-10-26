import path from 'node:path';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Db } from 'mongodb';
import { InputError, LIMITS } from '../analyze/parse.js';
import type { CheckRunner } from '../check/runner.js';
import type { Config } from '../config.js';
import type { Mailer } from '../mail/mailer.js';
import checkRoutes from './routes/check.js';
import contactRoutes from './routes/contact.js';
import notifyRoutes from './routes/notify.js';
import opsRoutes from './routes/ops.js';
import pages from './routes/pages.js';
import reportRoutes from './routes/report.js';
import type { Turnstile } from './turnstile.js';
import { assetVersion, createViews } from './views.js';


/** Pages that search engines may index; everything else (reports, notices, forms' results) is noindex. */
const INDEXABLE = new Set(['/', '/methodology', '/privacy', '/contact', '/r/sample', '/robots.txt', '/sitemap.xml']);
const SITEMAP = ['/', '/methodology', '/r/sample', '/privacy', '/contact'];
const isIndexable = (method: string, path: string, status: number) => (method === 'GET' || method === 'HEAD') && status === 200 && INDEXABLE.has(path);

/** Why POST /check sent the visitor back without a report. */
export type RefusedReason = 'turnstile-missing' | 'turnstile-failed' | 'input' | 'too-large';

export interface AppMetrics {
  limited(kind: 'check' | 'global' | 'contact' | 'notify'): void;
  confirmed(list: 'pdf' | 'pack'): void;
  refused(reason: RefusedReason): void;
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

export const noopMetrics: AppMetrics = { limited() {}, confirmed() {}, refused() {}, render: async () => '' };

/** Counts and logs a refused check. `detail` must be our own fixed text, never anything from the visitor's file. */
export function refuseCheck(deps: AppDeps, req: FastifyRequest, reason: RefusedReason, detail?: string): void {
  deps.metrics?.refused(reason);
  req.log.info({ refused: reason, ...(detail ? { detail } : {}) }, 'check refused');
}

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
  });
  const views = createViews(deps.config.NODE_ENV === 'production');
  const common = { siteKey: deps.config.TURNSTILE_SITE_KEY, v: assetVersion(), ogV: assetVersion(['og.png']), publicUrl: deps.config.PUBLIC_URL, title: '', turnstile: false, refresh: 0 };

  app.decorateReply('page', function (this: FastifyReply, template: string, data: Record<string, unknown> = {}, status = 200) {
    const urlPath = this.request.url.split('?')[0] ?? '/';
    const indexable = isIndexable(this.request.method, urlPath, status);
    const html = views.render(template, { ...common, url: `${deps.config.PUBLIC_URL}${urlPath}`, indexable, ...data });
    return this.code(status).type('text/html; charset=utf-8').send(html);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    // Only the public pages may appear in search results: reports are private links that expire after 30 days.
    const urlPath = req.url.split('?')[0] ?? '/';
    if (!urlPath.startsWith('/static/') && !isIndexable(req.method, urlPath, reply.statusCode)) reply.header('X-Robots-Tag', 'noindex');
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

  app.get('/robots.txt', (_req, reply) => reply.type('text/plain; charset=utf-8').send(`User-agent: *\nAllow: /\n\nSitemap: ${deps.config.PUBLIC_URL}/sitemap.xml\n`));
  app.get('/sitemap.xml', (_req, reply) => reply.type('application/xml; charset=utf-8').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
      SITEMAP.map((p) => `  <url><loc>${deps.config.PUBLIC_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`));

  app.setNotFoundHandler((_req, reply) =>
    reply.page('./notice', { title: 'Page not found', heading: 'Page not found', message: 'This page does not exist, or the report has expired (reports are kept for 30 days).' }, 404));

  app.setErrorHandler((err, req, reply) => {
    const isCheck = req.method === 'POST' && req.url.split('?')[0] === '/check';
    if (err instanceof InputError) {
      if (isCheck) refuseCheck(deps, req, 'input', err.userMessage);
      return reply.page('./notice', { title: 'Check failed', heading: "That file couldn't be checked", message: err.userMessage, back: true }, 400);
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 413 || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      if (isCheck) refuseCheck(deps, req, 'too-large');
      return reply.page('./notice', { title: 'File too large', heading: 'File too large', message: 'package.json can be up to 256 KB and the lockfile up to 10 MB.', back: true }, 413);
    }
    if (status >= 400 && status < 500) {
      return reply.page('./notice', { title: 'Bad request', heading: 'Something was wrong with that request', message: 'Please go back and try again.', back: true }, status);
    }
    req.log.error(err);
    return reply.page('./notice', { title: 'Error', heading: 'Something went wrong', message: 'Please try again in a minute.' }, 500);
  });

  await app.register(pages, deps);
  await app.register(checkRoutes, deps);
  await app.register(reportRoutes, deps);
  await app.register(notifyRoutes, deps);
  await app.register(contactRoutes, deps);
  await app.register(opsRoutes, deps);
  return app;
}
