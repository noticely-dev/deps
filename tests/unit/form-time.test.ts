import { describe, expect, it } from 'vitest';
import { checkFormTime, issueFormTime } from '../../src/web/form-time.js';

describe('form time token', () => {
  const t0 = new Date('2026-10-12T10:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  it('accepts a form filled after 3 s and within a day', () => {
    const v = issueFormTime('secret-secret-secret', t0);
    expect(checkFormTime('secret-secret-secret', v, at(1_000))).toBe(false);
    expect(checkFormTime('secret-secret-secret', v, at(5_000))).toBe(true);
    expect(checkFormTime('secret-secret-secret', v, at(2 * 86_400_000))).toBe(false);
  });
  it('rejects forged or missing values', () => {
    expect(checkFormTime('secret-secret-secret', `${t0.getTime() - 60_000}.deadbeef`, t0)).toBe(false);
    expect(checkFormTime('secret-secret-secret', undefined, t0)).toBe(false);
    expect(checkFormTime('secret-secret-secret', 'garbage', t0)).toBe(false);
  });
});
