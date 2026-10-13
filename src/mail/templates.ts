// Branded HTML emails with a plain-text alternative. Every interpolated value goes through esc().
// Email clients ignore <style> blocks and external CSS, so all styling is inline and table-based.

export interface EmailContent { subject: string; text: string; html: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const C = { fg: '#101828', mut: '#667085', line: '#eaecf0', bg: '#f2f4f7', acc: '#2563eb' };

const p = (html: string, extra = '') => `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:${C.fg};${extra}">${html}</p>`;
const small = (html: string) => `<p style="margin:0 0 8px;font:13px/1.6 ${FONT};color:${C.mut};">${html}</p>`;
const link = (href: string, label = href) => `<a href="${esc(href)}" style="color:${C.acc};text-decoration:underline;">${esc(label)}</a>`;
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:8px;background:${C.acc};">` +
  `<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>` +
  '</td></tr></table>';

function layout(o: { base: string; preheader: string; heading: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;padding:28px 32px 32px;">
<a href="${esc(o.base)}"><img src="${esc(o.base)}/static/brand/noticely-wordmark-light.png" width="120" height="32" alt="noticely" style="display:block;border:0;margin:0 0 24px;"></a>
<h1 style="margin:0 0 16px;font:700 22px/1.3 ${FONT};color:${C.fg};">${esc(o.heading)}</h1>
${o.body}
</td></tr>
<tr><td style="padding:20px 4px 0;">${o.footer}</td></tr>
</table></td></tr></table>
</body></html>`;
}

const brandLine = (base: string) => small(`noticely/deps · free dependency health checks for npm projects · ${link(base, base.replace(/^https?:\/\//, ''))}`);

/** Double opt-in email for a notify-me list. `what` reads like "the full PDF report is available". */
export function confirmEmail(o: { base: string; token: string; listTitle: string; what: string }): EmailContent {
  const confirm = `${o.base}/confirm/${o.token}`;
  const unsub = `${o.base}/unsubscribe/${o.token}`;
  return {
    subject: `Confirm your email for ${o.listTitle}`,
    text: [
      'Confirm your email',
      '',
      `You asked to be told when ${o.what} on noticely/deps. Confirm your address and you will get one email when it launches. Nothing else.`,
      '',
      `Confirm: ${confirm}`,
      '',
      "The link is valid for 7 days. If you didn't ask for this, ignore this email and the address is deleted automatically.",
      '',
      '--',
      `noticely/deps · ${o.base}`,
      `Unsubscribe: ${unsub}`,
    ].join('\n'),
    html: layout({
      base: o.base,
      preheader: 'One click to confirm. You will get a single email when it launches.',
      heading: 'Confirm your email',
      body: [
        p(`You asked to be told when ${esc(o.what)} on noticely/deps. Confirm your address and you'll get <b>one email</b> when it launches. Nothing else.`),
        button(confirm, 'Confirm email'),
        small(`Button not working? Open this link: ${link(confirm)}`),
        small("The link is valid for 7 days. If you didn't ask for this, ignore this email and the address is deleted automatically."),
      ].join('\n'),
      footer: brandLine(o.base) + small(`Changed your mind? ${link(unsub, 'Unsubscribe')}.`),
    }),
  };
}

/** Quote request from the contact form, sent to the owner; reply-to is the visitor. */
export function quoteRequestEmail(o: { base: string; name: string; email: string; company: string; reportUrl: string | null; message: string }): EmailContent {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 16px 6px 0;font:13px/1.5 ${FONT};color:${C.mut};white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;font:14px/1.5 ${FONT};color:${C.fg};">${v}</td></tr>`;
  return {
    subject: `Quote request: ${o.name}${o.company ? ` (${o.company})` : ''}`,
    text: [
      `From: ${o.name} <${o.email}>${o.company ? `, ${o.company}` : ''}`,
      `Report: ${o.reportUrl ?? 'none'}`,
      '',
      o.message,
      '',
      '--',
      'Reply to this email to answer the visitor directly.',
    ].join('\n'),
    html: layout({
      base: o.base,
      preheader: o.message.slice(0, 120),
      heading: 'New quote request',
      body: [
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">`,
        row('Name', esc(o.name)),
        row('Email', link(`mailto:${o.email}`, o.email)),
        o.company ? row('Company', esc(o.company)) : '',
        row('Report', o.reportUrl ? link(o.reportUrl) : `<span style="color:${C.mut};">none</span>`),
        '</table>',
        `<div style="border-left:3px solid ${C.line};padding:4px 0 4px 16px;margin:0 0 20px;font:15px/1.6 ${FONT};color:${C.fg};white-space:pre-wrap;">${esc(o.message)}</div>`,
        small('Reply to this email to answer the visitor directly.'),
      ].join('\n'),
      footer: brandLine(o.base),
    }),
  };
}
