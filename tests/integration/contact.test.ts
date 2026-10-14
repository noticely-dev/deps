import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueFormTime } from '../../src/web/form-time.js';
import { testApp } from '../helpers/app.js';
import { OWNER_NAME_RE } from '../helpers/owner.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => t.close());

const secret = 'dev-only-secret-change-me';
const valid = () => ({
  name: 'Ana', email: 'ana@client.test', company: 'Client Ltd', r: 'AAAAAAAAAAAAAAAAAAAAAA',
  message: 'Please quote the lodash and request upgrades for our API.', website: '',
  t: issueFormTime(secret, new Date(Date.now() - 10_000)), 'cf-turnstile-response': 'tok',
});
const post = (o: Record<string, string>, ip = '203.0.113.40') => t.app.inject({
  method: 'POST', url: '/contact', headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
  payload: new URLSearchParams(o).toString(),
});

describe('contact', () => {
  it('renders the form with the report link prefilled', async () => {
    const res = await t.app.inject({ url: '/contact?r=AAAAAAAAAAAAAAAAAAAAAA' });
    expect(res.body).toContain('name="r" value="AAAAAAAAAAAAAAAAAAAAAA"');
    expect(res.body).toContain('name="website"');
    expect(res.body).not.toMatch(OWNER_NAME_RE);
  });

  it('stores the message and emails the owner with reply-to', async () => {
    const res = await post(valid());
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Thanks');
    const mail = t.mails.at(-1);
    expect(mail).toMatchObject({ to: 'owner@example.com', replyTo: 'ana@client.test', subject: 'Quote request: Ana (Client Ltd)' });
    expect(mail?.text).toContain('http://localhost:8080/r/AAAAAAAAAAAAAAAAAAAAAA');
    expect(await t.db.collection('messages').countDocuments({ emailSent: true })).toBe(1);
  });

  it('has a privacy-request variant with its own heading and email subject', async () => {
    const page = (await t.app.inject({ url: '/contact?topic=privacy' })).body;
    expect(page).toContain('<h1>Privacy request</h1>');
    expect(page).toContain('name="topic" value="privacy"');
    expect(page).not.toContain('name="company"');
    expect((await t.app.inject({ url: '/contact?topic=<script>' })).body).toContain('<h1>Get a fixed-price quote</h1>');
    await post({ ...valid(), company: '', topic: 'privacy' }, '203.0.113.44');
    expect(t.mails.at(-1)?.subject).toBe('Privacy request: Ana');
  });

  it('silently drops honeypot submissions', async () => {
    const before = t.mails.length;
    const res = await post({ ...valid(), website: 'http://spam.test' }, '203.0.113.41');
    expect(res.statusCode).toBe(200);
    expect(t.mails.length).toBe(before);
  });

  it('rejects too-fast forms, link spam and header injection', async () => {
    expect((await post({ ...valid(), t: issueFormTime(secret, new Date()) }, '203.0.113.42')).statusCode).toBe(400);
    const spam = 'see https://a.test https://b.test https://c.test https://d.test https://e.test https://f.test';
    expect((await post({ ...valid(), message: spam }, '203.0.113.42')).statusCode).toBe(400);
    await post({ ...valid(), name: 'Eve\r\nBcc: victim@x.test' }, '203.0.113.43');
    expect(t.mails.at(-1)?.subject).toBe('Quote request: Eve Bcc: victim@x.test (Client Ltd)');
  });

  it('limits to 3 messages per IP per day', async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(valid(), '198.51.100.50')).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
