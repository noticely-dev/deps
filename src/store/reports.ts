import type { Db } from 'mongodb';
import type { ReportResult, SkippedDep, StoredDep } from '../analyze/types.js';

export const REPORT_TTL_MS = 30 * 86_400_000;
/** A check has a 30 s timeout; one still `running` after this long was lost (restart or crash). */
export const STALE_RUNNING_MS = 3 * 60_000;

export interface ReportDoc {
  _id: string;
  status: 'running' | 'done' | 'failed';
  projectName: string;
  hasLockfile: boolean;
  deps: StoredDep[];
  skipped: SkippedDep[];
  result?: ReportResult;
  error?: 'timeout' | 'error' | 'busy';
  createdAt: Date;
  finishedAt?: Date;
  expiresAt?: Date;
}

export type NewReport = Pick<ReportDoc, '_id' | 'projectName' | 'hasLockfile' | 'deps' | 'skipped'>;

const reports = (db: Db) => db.collection<ReportDoc>('reports');

export async function createReport(db: Db, r: NewReport, now: Date): Promise<void> {
  await reports(db).insertOne({ ...r, status: 'running', createdAt: now, expiresAt: new Date(now.getTime() + REPORT_TTL_MS) });
}

export async function upsertSampleReport(db: Db, r: Omit<NewReport, '_id'>, now: Date): Promise<void> {
  await reports(db).replaceOne({ _id: 'sample' }, { ...r, status: 'running', createdAt: now }, { upsert: true });
}

export function getReport(db: Db, id: string): Promise<ReportDoc | null> {
  return reports(db).findOne({ _id: id });
}

export async function setReportResult(db: Db, id: string, result: ReportResult): Promise<void> {
  await reports(db).updateOne({ _id: id }, { $set: { status: 'done', result, finishedAt: new Date() }, $unset: { error: '' } });
}

export async function setReportFailed(db: Db, id: string, error: NonNullable<ReportDoc['error']>): Promise<void> {
  await reports(db).updateOne({ _id: id }, { $set: { status: 'failed', error, finishedAt: new Date() } });
}

export function isStaleRunning(doc: Pick<ReportDoc, 'status' | 'createdAt'>, now: Date): boolean {
  return doc.status === 'running' && now.getTime() - doc.createdAt.getTime() > STALE_RUNNING_MS;
}

/** On startup: no check survives a restart (single process), so every report still `running` has failed. */
export async function failRunningReports(db: Db, now: Date): Promise<number> {
  const res = await reports(db).updateMany({ status: 'running' }, { $set: { status: 'failed', error: 'error', finishedAt: now } });
  return res.modifiedCount;
}
