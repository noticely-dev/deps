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
