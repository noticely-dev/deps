import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { mongoCache, type CacheDoc } from '../../src/store/cache.js';
import { hashToken, newReportId, newToken } from '../../src/store/ids.js';
import { hitLimit } from '../../src/store/ratelimits.js';
import { createReport, failRunningReports, getReport, setReportFailed, setReportResult } from '../../src/store/reports.js';
import { testDb } from '../helpers/mongo.js';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

const now = new Date('2026-10-12T10:00:00Z');

describe('indexes', () => {
  it('creates TTL indexes with the spec retention', async () => {
    const ttl = async (coll: string) =>
      (await db.collection(coll).indexes()).filter((i) => i.expireAfterSeconds !== undefined)
        .map((i) => [Object.keys(i.key)[0], i.expireAfterSeconds]);
    expect(await ttl('reports')).toEqual([['expiresAt', 0]]);
    expect(await ttl('packages')).toEqual([['fetchedAt', 86_400]]);
    expect(await ttl('advisories')).toEqual([['fetchedAt', 604_800]]);
    expect(await ttl('ratelimits')).toEqual([['expiresAt', 0]]);
    expect(await ttl('subscribers')).toEqual([['expiresAt', 0]]);
    expect(await ttl('messages')).toEqual([['createdAt', 15_552_000]]);
  });
});

describe('ids', () => {
  it('generates unguessable ids and tokens', () => {
    expect(newReportId()).toMatch(/^[0-9A-Za-z]{22}$/);
    expect(newReportId()).not.toBe(newReportId());
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('reports', () => {
  it('creates, completes and fails reports', async () => {
    const id = newReportId();
    await createReport(db, { _id: id, projectName: 'x', hasLockfile: false, deps: [], skipped: [] }, now);
    expect(await getReport(db, id)).toMatchObject({ status: 'running', expiresAt: new Date('2026-11-11T10:00:00Z') });
    await setReportResult(db, id, { score: 100 } as never);
    expect((await getReport(db, id))?.status).toBe('done');
    await setReportFailed(db, id, 'timeout');
    expect(await getReport(db, id)).toMatchObject({ status: 'failed', error: 'timeout' });
    expect(await getReport(db, 'nope')).toBeNull();
  });

  it('fails every report left running by a previous process', async () => {
    const [a, b, c] = [newReportId(), newReportId(), newReportId()];
    for (const id of [a, b, c]) await createReport(db, { _id: id, projectName: 'x', hasLockfile: false, deps: [], skipped: [] }, now);
    await setReportResult(db, c, { score: 100 } as never);
    const later = new Date('2026-10-12T11:00:00Z');
    expect(await failRunningReports(db, later)).toBe(2);
    for (const id of [a, b]) expect(await getReport(db, id)).toMatchObject({ status: 'failed', error: 'error', finishedAt: later });
    expect((await getReport(db, c))?.status).toBe('done');
  });
});

describe('rate limits', () => {
  it('allows exactly `limit` hits per key', async () => {
    const results = await Promise.all(Array.from({ length: 7 }, () => hitLimit(db, 'check:abc:2026-10-12', 5, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect((await hitLimit(db, 'check:other:2026-10-12', 5, now)).allowed).toBe(true);
  });
});

describe('cache', () => {
  it('stores and returns values including null', async () => {
    const cache = mongoCache(db.collection<CacheDoc>('packages'));
    expect(await cache.get('npm:x')).toBeNull();
    await cache.set('dl:x', null);
    expect(await cache.get('dl:x')).toEqual({ value: null });
    await cache.set('npm:x', { a: 1 });
    expect(await cache.get('npm:x')).toEqual({ value: { a: 1 } });
  });
});
