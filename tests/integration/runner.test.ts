import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from 'mongodb';
import { CheckRunner } from '../../src/check/runner.js';
import { newReportId } from '../../src/store/ids.js';
import { createReport, getReport } from '../../src/store/reports.js';
import { fakeSources, npmInfo } from '../helpers/fakes.js';
import { testDb } from '../helpers/mongo.js';

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(async () => close());

async function newReport() {
  const id = newReportId();
  await createReport(db, { _id: id, projectName: 'p', hasLockfile: false, skipped: [],
    deps: [{ name: 'a', spec: '1.0.0', scope: 'prod', lockVersion: null }] }, new Date());
  return id;
}

describe('CheckRunner', () => {
  it('runs a check to completion', async () => {
    const finished: string[] = [];
    const runner = new CheckRunner({ db, sources: fakeSources({ npm: { a: npmInfo() } }), replacements: {},
      metrics: { finished: (r) => finished.push(r) } });
    const id = await newReport();
    expect(runner.submit(id)).toBe(true);
    await runner.idle();
    expect(await getReport(db, id)).toMatchObject({ status: 'done', result: { score: 100 } });
    expect(finished).toEqual(['done']);
  });

  it('fails a check that exceeds the timeout', async () => {
    const runner = new CheckRunner({ db, sources: fakeSources({ npm: { a: npmInfo() }, delayMs: 200 }), replacements: {}, timeoutMs: 30 });
    const id = await newReport();
    runner.submit(id);
    await runner.idle();
    expect(await getReport(db, id)).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('refuses work beyond concurrency + queue limit', async () => {
    const runner = new CheckRunner({ db, sources: fakeSources({ delayMs: 100 }), replacements: {}, concurrency: 1, queueLimit: 1 });
    const ids = [await newReport(), await newReport(), await newReport()];
    expect(ids.map((id) => runner.submit(id))).toEqual([true, true, false]);
    await runner.idle();
  });
});
