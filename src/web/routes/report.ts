import type { FastifyInstance } from 'fastify';
import { isStaleRunning } from '../../store/reports.js';
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

    if (isStaleRunning(doc, (deps.clock ?? (() => new Date()))())) doc.status = 'failed';
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
    if (format === 'md') {
      // Only safe characters in the filename: the project name comes from the visitor's package.json.
      const file = `${doc.projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || 'project'}-dependency-report.md`;
      return reply.type('text/markdown; charset=utf-8').header('Content-Disposition', `attachment; filename="${file}"`).send(toMarkdown(doc, deps.config.PUBLIC_URL));
    }
    const r = toReportView(doc, deps.config.PUBLIC_URL);
    return reply.page('./report', { title: `${doc.projectName} · dependency report`, turnstile: true, r });
  });
}
