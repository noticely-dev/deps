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

  it('answers 503 when the queue is full', async () => {
    const full = await testApp();
    (full.runner as unknown as { submit: () => boolean }).submit = () => false;
    const m = multipart({ 'cf-turnstile-response': 'tok', packageJson: pkg });
    const res = await full.app.inject({ method: 'POST', url: '/check', payload: m.payload, headers: m.headers });
    expect(res.statusCode).toBe(503);
    await full.close();
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
