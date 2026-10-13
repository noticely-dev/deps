import type { FastifyInstance, FastifyReply } from 'fastify';
import { InputError, parseInput } from '../../analyze/parse.js';
import { newReportId, REPORT_ID_RE } from '../../store/ids.js';
import { createReport, getReport, isStaleRunning, setReportFailed, type ReportDoc } from '../../store/reports.js';
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
      return reply.page('./notice', { title: 'Verification failed', heading: 'Please complete the verification', message: 'The automatic bot check did not finish. Go back, wait a few seconds, and submit again.', back: true }, 400);
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
    return { status: isStaleRunning(doc, (deps.clock ?? (() => new Date()))()) ? 'failed' : doc.status };
  });
}
