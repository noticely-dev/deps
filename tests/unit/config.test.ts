import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(8080);
    expect(cfg.CHECKS_PER_DAY).toBe(5);
    expect(cfg.GLOBAL_CHECKS_PER_DAY).toBe(500);
    expect(cfg.MAIL_FROM).toBe('noticely <hello@noticely.dev>');
  });

  it('coerces numbers from strings', () => {
    expect(loadConfig({ PORT: '9000', CHECKS_PER_DAY: '7' })).toMatchObject({ PORT: 9000, CHECKS_PER_DAY: 7 });
  });

  it('refuses to start in production with development secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/IP_HASH_SECRET/);
  });

  it('accepts a complete production config', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://deps.noticely.dev',
      MONGO_URL: 'mongodb://u:p@deps-mongo:27017/?authSource=admin',
      TURNSTILE_SITE_KEY: '0x4AAAAAAAreal',
      TURNSTILE_SECRET: '0x4AAAAAAArealsecret',
      RESEND_API_KEY: 're_123',
      CONTACT_TO: 'owner@example.com',
      IP_HASH_SECRET: 'a'.repeat(32),
    });
    expect(cfg.NODE_ENV).toBe('production');
  });
});
