import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken, newToken } from '../../src/store/ids.js';
import { confirmSignup, requestSignup } from '../../src/store/subscribers.js';
import { testApp } from '../helpers/app.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const form = (o: Record<string, string>, ip = '203.0.113.20') => t.app.inject({
  method: 'POST', url: '/notify', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
  payload: new URLSearchParams({ 'cf-turnstile-response': 'tok', ...o }).toString(),
});
const tokenFrom = (text: string, kind: 'confirm' | 'unsubscribe') => new RegExp(`/${kind}/([A-Za-z0-9_-]{43})`).exec(text)?.[1] ?? '';
// What the one-button form on the GET page sends: an empty form body to the same path.
const post = (url: string) => t.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
const statusOf = async (email: string, list: string) => (await t.db.collection('subscribers').findOne({ email, list }))?.status;

describe('notify-me', () => {
  it('double opt-in: email, confirm, idempotent repeat', async () => {
    const res = await form({ email: 'Dev@Example.com', list: 'pdf', r: 'sample' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Check your inbox');
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]).toMatchObject({ to: 'dev@example.com', subject: expect.stringContaining('Confirm') });
    const token = tokenFrom(t.mails[0]?.text ?? '', 'confirm');
    expect(tokenFrom(t.mails[0]?.text ?? '', 'unsubscribe')).toBe(token);

    // A mail scanner prefetching the link only gets a page with a button; nothing changes.
    const page = await t.app.inject({ url: `/confirm/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`<form method="post" action="/confirm/${token}">`);
    expect(page.body).not.toContain('on the list');
    expect(await statusOf('dev@example.com', 'pdf')).toBe('pending');
    expect(t.events).not.toContain('confirmed:pdf');

    const confirm = await post(`/confirm/${token}`);
    expect(confirm.body).toContain('You&#39;re on the list');
    expect(t.events).toContain('confirmed:pdf');
    expect(await statusOf('dev@example.com', 'pdf')).toBe('confirmed');
    expect((await post(`/confirm/${token}`)).body).toContain('already confirmed');

    // Signing up again after confirming: same page, no new email
    const again = await form({ email: 'dev@example.com', list: 'pdf' });
    expect(again.body).toContain('Check your inbox');
    expect(t.mails).toHaveLength(1);
  });

  it('unsubscribes, and handles unknown or malformed tokens kindly', async () => {
    await form({ email: 'u@example.com', list: 'pack' }, '203.0.113.21');
    const token = tokenFrom(t.mails.at(-1)?.text ?? '', 'unsubscribe');
    await post(`/confirm/${token}`);
    const page = await t.app.inject({ url: `/unsubscribe/${token}` });
    expect(page.body).toContain(`<form method="post" action="/unsubscribe/${token}">`);
    expect(page.body).not.toContain('unsubscribed');
    expect(await statusOf('u@example.com', 'pack')).toBe('confirmed');
    expect((await post(`/unsubscribe/${token}`)).body).toContain('unsubscribed');
    expect(await statusOf('u@example.com', 'pack')).toBe('unsubscribed');
    expect((await post(`/unsubscribe/${token}`)).body).toContain('unsubscribed');
    for (const url of [`/unsubscribe/${'A'.repeat(43)}`, `/confirm/${'A'.repeat(43)}`, '/confirm/<script>', '/unsubscribe/<script>']) {
      for (const res of [await t.app.inject({ url }), await post(url)]) {
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain('no longer valid');
      }
    }
    // An unsubscribed address can't be confirmed again with the old link.
    expect((await t.app.inject({ url: `/confirm/${token}` })).body).toContain('no longer valid');
  });

  it('validates input, Turnstile and the daily limit', async () => {
    expect((await form({ email: 'not-an-email', list: 'pdf' }, '203.0.113.22')).statusCode).toBe(400);
    expect((await form({ email: 'a@b.test', list: 'vip' }, '203.0.113.22')).statusCode).toBe(400);
    t.setTurnstile(false);
    expect((await form({ email: 'a@b.test', list: 'pdf' }, '203.0.113.22')).statusCode).toBe(400);
    t.setTurnstile(true);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await form({ email: `x${i}@b.test`, list: 'pack' }, '203.0.113.23')).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('does not email twice while pending, and the first link still confirms', async () => {
    const before = t.mails.length;
    await form({ email: 'twice@example.com', list: 'pdf' }, '203.0.113.30');
    const second = await form({ email: 'twice@example.com', list: 'pdf' }, '203.0.113.30');
    expect(second.body).toContain('Check your inbox');
    expect(t.mails.length).toBe(before + 1);
    const token = tokenFrom(t.mails.at(-1)?.text ?? '', 'confirm');
    expect((await post(`/confirm/${token}`)).body).toContain('You&#39;re on the list');
  });

  it('re-sends after 24 h and rejects expired confirmations', async () => {
    const t0 = new Date('2026-10-01T00:00:00Z');
    const day = 86_400_000;
    const a = newToken();
    expect(await requestSignup(t.db, 'store@example.com', 'pdf', hashToken(a), t0)).toBe('pending');
    expect(await requestSignup(t.db, 'store@example.com', 'pdf', hashToken(newToken()), new Date(t0.getTime() + day - 1000))).toBe('already-pending');
    const b = newToken();
    expect(await requestSignup(t.db, 'store@example.com', 'pdf', hashToken(b), new Date(t0.getTime() + day + 1000))).toBe('pending');
    expect((await confirmSignup(t.db, hashToken(a), new Date(t0.getTime() + day + 2000))).result).toBe('invalid');

    const c = newToken();
    await requestSignup(t.db, 'expired@example.com', 'pack', hashToken(c), t0);
    expect((await confirmSignup(t.db, hashToken(c), new Date(t0.getTime() + 8 * day))).result).toBe('invalid');
    expect((await confirmSignup(t.db, hashToken(b), new Date(t0.getTime() + 2 * day))).result).toBe('confirmed');
  });
});
