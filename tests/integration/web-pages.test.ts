import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../helpers/app.js';
import { OWNER_NAME_RE } from '../helpers/owner.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

describe('pages', () => {
  it('serves the home page with the check form and strict headers', async () => {
    const res = await t.app.inject({ url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('action="/check"');
    expect(res.body).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(res.headers['content-security-policy']).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).not.toMatch(/<script>(?!<\/script>)/); // no inline scripts
    expect(res.body).not.toMatch(/\sstyle="/);
  });

  it('explains the methodology with the real numbers', async () => {
    const res = await t.app.inject({ url: '/methodology' });
    expect(res.statusCode).toBe(200);
    for (const s of ['−25', '−12', '−5', '−1', '85–100', '2 years', '15 min']) expect(res.body).toContain(s);
  });

  it('serves privacy, static files and favicons', async () => {
    const privacy = (await t.app.inject({ url: '/privacy' })).body;
    expect(privacy).toContain('30 days');
    expect(privacy).toContain('deleted after 7 days unless you click the confirmation link');
    expect(privacy).not.toContain('stored only after');
    expect((await t.app.inject({ url: '/static/app.css' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.ico' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.svg' })).statusCode).toBe(200);
  });

  it('renders a friendly 404', async () => {
    const res = await t.app.inject({ url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Page not found');
  });

  it('never shows the owner name', async () => {
    for (const url of ['/', '/methodology', '/privacy']) {
      expect((await t.app.inject({ url })).body).not.toMatch(OWNER_NAME_RE);
    }
  });
});
