import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getReport } from '../../src/store/reports.js';
import { testApp } from '../helpers/app.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';
import { multipart } from '../helpers/multipart.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ sources: fakeSources({ npm: { express: npmInfo({ latest: '5.1.0', versions: ['5.1.0'] }) } }) }); });
afterAll(async () => t.close());

const pkg = JSON.stringify({ name: 'demo', dependencies: { express: '^5.1.0' } });
const post = (fields: Parameters<typeof multipart>[0], ip = '203.0.113.1') => {
  const m = multipart({ 'cf-turnstile-response': 'tok', ...fields });
  return t.app.inject({ method: 'POST', url: '/check', payload: m.payload, headers: { ...m.headers, 'cf-connecting-ip': ip } });
};

describe('POST /check', () => {
  it('creates a report and redirects to it', async () => {
    const res = await post({ packageJson: pkg });
    expect(res.statusCode).toBe(303);
    const id = String(res.headers.location).replace('/r/', '');
    expect(id).toMatch(/^[0-9A-Za-z]{22}$/);
    await t.runner.idle();
    const doc = await getReport(t.db, id);
    expect(doc).toMatchObject({ status: 'done', projectName: 'demo', hasLockfile: false });
    expect(doc?.deps).toEqual([{ name: 'express', spec: '^5.1.0', scope: 'prod', lockVersion: null }]);
  });

  it('accepts an uploaded file and a lockfile', async () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/express': { version: '5.1.0' } } });
    const res = await post({ packageJsonFile: { filename: 'package.json', content: pkg }, lockfile: { filename: 'package-lock.json', content: lock } }, '203.0.113.2');
    expect(res.statusCode).toBe(303);
    const doc = await getReport(t.db, String(res.headers.location).slice(3));
    expect(doc?.deps[0]?.lockVersion).toBe('5.1.0');
  });

  it('rejects a failed Turnstile check', async () => {
    t.setTurnstile(false);
    const res = await post({ packageJson: pkg }, '203.0.113.3');
    t.setTurnstile(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('verification');
  });

  it('counts refused checks by reason, without the file contents', async () => {
    const before = t.events.length;
    t.setTurnstile(false);
    const noToken = multipart({ packageJson: pkg });
    await t.app.inject({ method: 'POST', url: '/check', payload: noToken.payload, headers: { ...noToken.headers, 'cf-connecting-ip': '203.0.113.5' } });
    await post({ packageJson: pkg }, '203.0.113.5');
    t.setTurnstile(true);
    await post({ packageJson: '{nope' }, '203.0.113.5');
    const big = await post({ packageJson: pkg, lockfile: { filename: 'package-lock.json', content: 'a'.repeat(10 * 1024 * 1024 + 1) } }, '203.0.113.5');
    expect(big.statusCode).toBe(413);
    expect(t.events.slice(before)).toEqual(['refused:turnstile-missing', 'refused:turnstile-failed', 'refused:input', 'refused:too-large']);
  });

  it('explains missing or invalid input', async () => {
    expect((await post({}, '203.0.113.4')).body).toContain('Paste your package.json');
    const bad = await post({ packageJson: '{nope' }, '203.0.113.4');
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('This is not valid JSON');
  });

  it('allows 5 checks per IP per day, then offers the check pack', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ packageJson: pkg }, '198.51.100.7')).statusCode);
    expect(codes).toEqual([303, 303, 303, 303, 303, 429]);
    const last = await post({ packageJson: pkg }, '198.51.100.7');
    expect(last.body).toContain('check pack');
    expect(last.body).toContain('name="list" value="pack"');
    expect(t.events).toContain('limited:check');
    expect((await post({ packageJson: pkg }, '198.51.100.8')).statusCode).toBe(303);
  });

  const counts = async (app: Awaited<ReturnType<typeof testApp>>) =>
    (await app.db.collection<{ _id: string; count: number }>('ratelimits').find().toArray()).map((d) => [d._id.split(':')[0] === 'global' ? 'global' : 'ip', d.count]);
  const postTo = (app: Awaited<ReturnType<typeof testApp>>) => {
    const m = multipart({ 'cf-turnstile-response': 'tok', packageJson: pkg });
    return app.app.inject({ method: 'POST', url: '/check', payload: m.payload, headers: m.headers });
  };

  it('answers 503 when the queue is full, without using up a daily check', async () => {
    const full = await testApp();
    Object.defineProperty(full.runner, 'hasCapacity', { get: () => false });
    const res = await postTo(full);
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('did not count towards your daily checks');
    expect(await counts(full)).toEqual([]);
    await full.close();
  });

  it('gives the checks back when the queue fills up between the check and the submit', async () => {
    const full = await testApp();
    (full.runner as unknown as { submit: () => boolean }).submit = () => false;
    expect((await postTo(full)).statusCode).toBe(503);
    expect(await counts(full)).toEqual(expect.arrayContaining([['ip', 0], ['global', 0]]));
    await full.close();
  });

  it('gives the per-IP check back when the global daily cap is reached', async () => {
    const capped = await testApp({ config: { GLOBAL_CHECKS_PER_DAY: 0 } });
    const res = await postTo(capped);
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('Daily capacity reached');
    expect(await counts(capped)).toEqual(expect.arrayContaining([['ip', 0]]));
    await capped.close();
  });
});

describe('GET /r/:id/status', () => {
  it('returns the status as JSON and 404 for unknown ids', async () => {
    const res = await post({ packageJson: pkg }, '203.0.113.9');
    const id = String(res.headers.location).slice(3);
    const status = await t.app.inject({ url: `/r/${id}/status` });
    expect(['running', 'done']).toContain(status.json().status);
    expect((await t.app.inject({ url: '/r/AAAAAAAAAAAAAAAAAAAAAA/status' })).statusCode).toBe(404);
    expect((await t.app.inject({ url: '/r/..%2F..%2Fetc/status' })).statusCode).toBe(404);
  });
});
