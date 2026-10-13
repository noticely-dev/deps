import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashToken, newToken, REPORT_ID_RE, TOKEN_RE } from '../../store/ids.js';
import { confirmSignup, findByToken, requestSignup, unsubscribe, type List } from '../../store/subscribers.js';
import type { AppDeps } from '../app.js';
import { clientIp } from '../client-ip.js';
import { consume } from '../limits.js';

const Body = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  list: z.enum(['pdf', 'pack']),
  r: z.string().optional(),
  'cf-turnstile-response': z.string().max(2048).optional(),
});

const LIST_NAME: Record<List, string> = { pdf: 'the full PDF report', pack: 'check packs' };
const INVALID = { title: 'Link expired', heading: 'This link is no longer valid', message: 'It may have expired or already been used. You can sign up again from any report page.', back: true };

export default async function notifyRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const now = () => (deps.clock ?? (() => new Date()))();

  app.post('/notify', async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.page('./notice', { title: 'Check your email', heading: 'That email address looks wrong', message: 'Please go back and enter a valid email address.', back: true }, 400);
    }
    const { email, list } = parsed.data;
    const ip = clientIp(req);
    if (!(await deps.turnstile.verify(parsed.data['cf-turnstile-response'], ip))) {
      return reply.page('./notice', { title: 'Verification failed', heading: 'Please complete the verification', message: 'The automatic bot check did not finish. Go back, wait a few seconds, and submit again.', back: true }, 400);
    }
    if (!(await consume(deps, 'notify', ip, 5))) {
      return reply.page('./notice', { title: 'Too many requests', heading: 'Too many sign-ups from your network today', message: 'Please try again tomorrow.', back: true }, 429);
    }
    const token = newToken();
    if ((await requestSignup(deps.db, email, list, hashToken(token), now())) === 'pending') {
      const base = deps.config.PUBLIC_URL;
      await deps.mailer.send({
        to: email,
        subject: `Confirm: notify me about ${LIST_NAME[list]}`,
        text: [
          `Someone (hopefully you) asked to be notified when ${LIST_NAME[list]} become available on noticely/deps.`,
          '',
          `To confirm, open this link and press the button: ${base}/confirm/${token}`,
          '',
          "If this wasn't you, ignore this email and nothing happens; the request expires in 7 days.",
          `Unsubscribe at any time: ${base}/unsubscribe/${token}`,
        ].join('\n'),
      }).catch((err) => req.log.error({ err }, 'confirmation email failed'));
    }
    // Same answer whether or not the address was already confirmed, so the form can't be used to probe the lists.
    const back = parsed.data.r && REPORT_ID_RE.test(parsed.data.r) ? { href: `/r/${parsed.data.r}`, label: 'Back to the report' } : undefined;
    return reply.page('./notice', { title: 'Check your inbox', heading: 'Check your inbox', message: `If ${email} isn't on the list yet, a confirmation link is on its way. Click it to finish signing up.`, link: back });
  });

  // Confirm and unsubscribe links open a page with a one-button form; only the POST changes anything,
  // so mail scanners that prefetch links can't confirm or unsubscribe anyone.
  app.get<{ Params: { token: string } }>('/confirm/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const sub = await findByToken(deps.db, hashToken(req.params.token));
    const valid = sub?.status === 'confirmed' || (sub?.status === 'pending' && !!sub.expiresAt && sub.expiresAt > now());
    if (!sub || !valid) return reply.page('./notice', INVALID);
    return reply.page('./notice', {
      title: 'Confirm sign-up', heading: 'Confirm your sign-up',
      message: `Confirm that you want one email when ${LIST_NAME[sub.list]} are available.`,
      action: { href: `/confirm/${req.params.token}`, label: 'Confirm' },
    });
  });

  app.post<{ Params: { token: string } }>('/confirm/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const { result, list } = await confirmSignup(deps.db, hashToken(req.params.token), now());
    if (result === 'invalid') return reply.page('./notice', INVALID);
    if (result === 'confirmed' && list) deps.metrics?.confirmed(list);
    return reply.page('./notice', {
      title: 'Confirmed',
      heading: result === 'confirmed' ? "You're on the list" : 'You have already confirmed',
      message: result === 'confirmed' ? `You'll get one email when ${LIST_NAME[list as List]} are available.` : 'Nothing more to do. You are already confirmed.',
      back: true,
    });
  });

  app.get<{ Params: { token: string } }>('/unsubscribe/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const sub = await findByToken(deps.db, hashToken(req.params.token));
    if (!sub) return reply.page('./notice', INVALID);
    return reply.page('./notice', {
      title: 'Unsubscribe', heading: 'Stop these emails?',
      message: `You will not get the email about ${LIST_NAME[sub.list]}.`,
      action: { href: `/unsubscribe/${req.params.token}`, label: 'Unsubscribe' },
    });
  });

  app.post<{ Params: { token: string } }>('/unsubscribe/:token', async (req, reply) => {
    if (!TOKEN_RE.test(req.params.token)) return reply.page('./notice', INVALID);
    const r = await unsubscribe(deps.db, hashToken(req.params.token), now());
    return r === 'ok'
      ? reply.page('./notice', { title: 'Unsubscribed', heading: "You're unsubscribed", message: 'You will not receive any more emails from this list.', back: true })
      : reply.page('./notice', INVALID);
  });
}
