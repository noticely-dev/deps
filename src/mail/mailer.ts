import type { FetchFn } from '../sources/http.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface Mailer {
  send(m: MailMessage): Promise<void>;
}

/** Development mailer: writes the email to the log instead of sending it. */
export function createLogMailer(log: (line: string) => void): Mailer {
  return {
    async send(m) {
      log(`[mail] to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
    },
  };
}

export function createResendMailer(o: { apiKey: string; from: string; fetch: FetchFn }): Mailer {
  return {
    async send(m) {
      const res = await o.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}
