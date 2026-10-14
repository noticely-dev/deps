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
    expect(res.body).toContain('<textarea id="packageJson" name="packageJson"');
    expect(res.body).toContain('data-editor-gutter');
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
    expect(privacy).toContain('Unconfirmed addresses are deleted after 7 days');
    expect(privacy).not.toContain('stored only after');
    expect(privacy).toContain('href="/contact?topic=privacy"');
    expect((await t.app.inject({ url: '/static/app.css' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.ico' })).statusCode).toBe(200);
    expect((await t.app.inject({ url: '/favicon.svg' })).statusCode).toBe(200);
  });

  it('versions the stylesheet and script so deploys bypass the static cache', async () => {
    const body = (await t.app.inject({ url: '/' })).body;
    const v = /app\.css\?v=([0-9a-f]{10})"/.exec(body)?.[1];
    expect(v).toBeDefined();
    expect(body).toContain(`/static/app.js?v=${v}"`);
    expect(body).toContain('data-appearance="interaction-only"');
  });

  it('lets search engines index the public pages, with canonical links and a share preview', async () => {
    for (const [url, canonical] of [['/', '/'], ['/methodology', '/methodology'], ['/contact?topic=privacy', '/contact']]) {
      const res = await t.app.inject({ url });
      expect(res.headers['x-robots-tag']).toBeUndefined();
      expect(res.body).toContain(`<link rel="canonical" href="http://localhost:8080${canonical}">`);
      expect(res.body).not.toContain('name="robots"');
    }
    const home = (await t.app.inject({ url: '/' })).body;
    expect(home).toMatch(/<meta property="og:image" content="http:\/\/localhost:8080\/static\/og\.png\?v=[0-9a-f]{10}">/);
    expect(home).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(home).toContain('<meta property="og:title" content="noticely/deps · dependency health check for npm projects">');
    expect((await t.app.inject({ url: '/static/og.png' })).statusCode).toBe(200);
  });

  it('serves robots.txt and a sitemap of the public pages', async () => {
    const robots = await t.app.inject({ url: '/robots.txt' });
    expect(robots.body).toContain('Sitemap: http://localhost:8080/sitemap.xml');
    expect(robots.body).not.toContain('Disallow: /r/');
    const sitemap = await t.app.inject({ url: '/sitemap.xml' });
    expect(sitemap.headers['content-type']).toContain('application/xml');
    for (const p of ['/', '/methodology', '/r/sample', '/privacy', '/contact']) expect(sitemap.body).toContain(`<loc>http://localhost:8080${p}</loc>`);
    expect(sitemap.body).not.toMatch(/\/r\/[0-9A-Za-z]{22}/);
  });

  it('keeps 404s and notices out of search results', async () => {
    const res = await t.app.inject({ url: '/nope' });
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.body).toContain('<meta name="robots" content="noindex">');
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
