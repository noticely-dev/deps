import { readFileSync } from 'node:fs';
import type { Db } from 'mongodb';
import { parseInput } from '../analyze/parse.js';
import { getReport, isStaleRunning, promoteSample, SAMPLE_NEXT, upsertSampleReport } from '../store/reports.js';
import type { CheckRunner } from './runner.js';

export const SAMPLE_MAX_AGE_MS = 24 * 3_600_000;

export async function ensureSample(db: Db, runner: CheckRunner, file: string, now: Date, maxAgeMs = SAMPLE_MAX_AGE_MS): Promise<boolean> {
  const existing = await getReport(db, 'sample');
  if (existing && existing.status !== 'failed' && !isStaleRunning(existing, now) && now.getTime() - existing.createdAt.getTime() < maxAgeMs) return false;
  const parsed = parseInput(readFileSync(file, 'utf8'), null);
  const report = { projectName: parsed.projectName, hasLockfile: false, deps: parsed.deps, skipped: parsed.skipped };
  // A good sample stays visible while its replacement is checked, and is swapped only if that check succeeds.
  if (existing?.status === 'done') {
    await upsertSampleReport(db, report, now, SAMPLE_NEXT);
    return runner.submit(SAMPLE_NEXT, () => promoteSample(db));
  }
  await upsertSampleReport(db, report, now);
  return runner.submit('sample');
}
