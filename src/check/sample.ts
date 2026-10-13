import { readFileSync } from 'node:fs';
import type { Db } from 'mongodb';
import { parseInput } from '../analyze/parse.js';
import { getReport, isStaleRunning, upsertSampleReport } from '../store/reports.js';
import type { CheckRunner } from './runner.js';

export const SAMPLE_MAX_AGE_MS = 24 * 3_600_000;

export async function ensureSample(db: Db, runner: CheckRunner, file: string, now: Date, maxAgeMs = SAMPLE_MAX_AGE_MS): Promise<boolean> {
  const existing = await getReport(db, 'sample');
  if (existing && existing.status !== 'failed' && !isStaleRunning(existing, now) && now.getTime() - existing.createdAt.getTime() < maxAgeMs) return false;
  const parsed = parseInput(readFileSync(file, 'utf8'), null);
  await upsertSampleReport(db, { projectName: parsed.projectName, hasLockfile: false, deps: parsed.deps, skipped: parsed.skipped }, now);
  return runner.submit('sample');
}
