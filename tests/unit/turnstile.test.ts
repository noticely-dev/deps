import { describe, expect, it } from 'vitest';
import { createTurnstile } from '../../src/web/turnstile.js';
import { fakeFetch } from '../helpers/fakes.js';

describe('turnstile', () => {
  it('accepts only success:true and sends secret, token and IP', async () => {
    const ok = fakeFetch(() => ({ body: { success: true } }));
    expect(await createTurnstile({ secret: 's', fetch: ok.fetch }).verify('tok', '1.2.3.4')).toBe(true);
    expect(JSON.parse(ok.calls[0]?.body ?? '{}')).toEqual({ secret: 's', response: 'tok', remoteip: '1.2.3.4' });
    const no = fakeFetch(() => ({ body: { success: false } }));
    expect(await createTurnstile({ secret: 's', fetch: no.fetch }).verify('tok', '1.2.3.4')).toBe(false);
    const down = fakeFetch(() => ({ status: 500 }));
    expect(await createTurnstile({ secret: 's', fetch: down.fetch }).verify('tok', '1.2.3.4')).toBe(false);
    expect(await createTurnstile({ secret: 's', fetch: ok.fetch }).verify(undefined, '1.2.3.4')).toBe(false);
  });

  it('logs the HTTP status and error codes of failed verifications, never the token or IP', async () => {
    const lines: string[] = [];
    const log = (msg: string) => lines.push(msg);
    const token = 'secret-token-value';
    const rejected = fakeFetch(() => ({ body: { success: false, 'error-codes': ['timeout-or-duplicate', 'invalid-input-response'] } }));
    expect(await createTurnstile({ secret: 's', fetch: rejected.fetch, log }).verify(token, '198.51.100.7')).toBe(false);
    const down = fakeFetch(() => ({ status: 503 }));
    expect(await createTurnstile({ secret: 's', fetch: down.fetch, log }).verify(token, '198.51.100.7')).toBe(false);
    const broken = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    expect(await createTurnstile({ secret: 's', fetch: broken, log }).verify(token, '198.51.100.7')).toBe(false);
    const ok = fakeFetch(() => ({ body: { success: true } }));
    expect(await createTurnstile({ secret: 's', fetch: ok.fetch, log }).verify(token, '198.51.100.7')).toBe(true);

    expect(lines).toEqual([
      'turnstile verify rejected: error-codes [timeout-or-duplicate, invalid-input-response]',
      'turnstile verify failed: HTTP 503',
      'turnstile verify failed: TypeError: fetch failed',
    ]);
    expect(lines.join('\n')).not.toMatch(/secret-token-value|198\.51\.100\.7/);
  });
});
