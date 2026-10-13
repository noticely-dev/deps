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
