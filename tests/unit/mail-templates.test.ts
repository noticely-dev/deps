import { describe, expect, it } from 'vitest';
import { confirmEmail, quoteRequestEmail } from '../../src/mail/templates.js';
import { OWNER_NAME_RE } from '../helpers/owner.js';

const base = 'https://deps.noticely.dev';

describe('email templates', () => {
  it('confirmation email has a button, a fallback link, an unsubscribe link and a text version', () => {
    const m = confirmEmail({ base, token: 'TOKEN123', listTitle: 'the noticely PDF report', what: 'the full PDF report is available' });
    expect(m.subject).toBe('Confirm your email for the noticely PDF report');
    expect(m.html).toContain(`href="${base}/confirm/TOKEN123"`);
    expect(m.html).toContain('>Confirm email</a>');
    expect(m.html).toContain(`href="${base}/unsubscribe/TOKEN123"`);
    expect(m.html).toContain(`${base}/static/brand/noticely-wordmark-light.png`);
    expect(m.text).toContain(`Confirm: ${base}/confirm/TOKEN123`);
    expect(m.text).toContain(`Unsubscribe: ${base}/unsubscribe/TOKEN123`);
    expect(m.html + m.text).not.toMatch(OWNER_NAME_RE);
  });

  it('quote request escapes visitor input and keeps the message as written', () => {
    const m = quoteRequestEmail({ base, name: '<b>Eve</b>', email: 'eve@x.test', company: 'A & B', reportUrl: `${base}/r/abc`,
      message: 'Line one\n<script>alert(1)</script>' });
    expect(m.subject).toBe('Quote request: <b>Eve</b> (A & B)');
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Eve</b>');
    expect(m.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(m.html).toContain('A &amp; B');
    expect(m.html).toContain('white-space:pre-wrap;">Line one\n&lt;script&gt;');
    expect(m.html).toContain(`href="${base}/r/abc"`);
    expect(m.text).toContain('From: <b>Eve</b> <eve@x.test>, A & B');
    expect(m.text).toContain('Report: https://deps.noticely.dev/r/abc');
  });
});
