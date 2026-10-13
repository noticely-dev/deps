import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';

export default async function pages(app: FastifyInstance, _deps: AppDeps): Promise<void> {
  app.get('/', (_req, reply) => reply.page('./home', { turnstile: true }));
  app.get('/methodology', (_req, reply) => reply.page('./methodology', { title: 'Methodology' }));
  app.get('/privacy', (_req, reply) => reply.page('./privacy', { title: 'Privacy' }));
}
