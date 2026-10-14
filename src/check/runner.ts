import type { Db } from 'mongodb';
import type { Replacement } from '../analyze/types.js';
import type { Sources } from '../sources/index.js';
import { getReport, setReportFailed, setReportResult } from '../store/reports.js';
import { analyzeDeps } from './analyze-deps.js';

export interface CheckMetrics { finished(result: 'done' | 'failed' | 'timeout', seconds: number): void }

export interface RunnerOptions {
  db: Db;
  sources: Sources;
  replacements: Record<string, Replacement>;
  clock?: () => Date;
  timeoutMs?: number;
  concurrency?: number;
  queueLimit?: number;
  metrics?: CheckMetrics;
  log?: (msg: string, err?: unknown) => void;
}

export class CheckRunner {
  private readonly queue: Array<{ id: string; onSettled?: () => void | Promise<void> }> = [];
  private running = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly o: RunnerOptions) {}

  get active(): number { return this.running; }
  get queued(): number { return this.queue.length; }

  /** False when the queue is full, so callers can refuse before charging any quota. */
  get hasCapacity(): boolean {
    return this.running < (this.o.concurrency ?? 4) || this.queue.length < (this.o.queueLimit ?? 20);
  }

  /** Queues a report; `onSettled` runs after it finished, failed or timed out. */
  submit(reportId: string, onSettled?: () => void | Promise<void>): boolean {
    if (!this.hasCapacity) return false;
    this.queue.push({ id: reportId, onSettled });
    this.pump();
    return true;
  }

  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    const concurrency = this.o.concurrency ?? 4;
    while (this.running < concurrency && this.queue.length > 0) {
      const { id, onSettled } = this.queue.shift() as { id: string; onSettled?: () => void | Promise<void> };
      this.running++;
      void this.run(id).then(async () => {
        try { await onSettled?.(); } catch (err) { this.o.log?.(`after check ${id} failed`, err); }
      }).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          const w = this.waiters;
          this.waiters = [];
          w.forEach((fn) => fn());
        }
      });
    }
  }

  private async run(id: string): Promise<void> {
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    const signal = AbortSignal.timeout(this.o.timeoutMs ?? 30_000);
    try {
      const doc = await getReport(this.o.db, id);
      if (!doc || doc.status !== 'running') return;
      const result = await analyzeDeps(doc, this.o.sources, this.o.replacements, (this.o.clock ?? (() => new Date()))(), signal);
      if (signal.aborted) throw signal.reason;
      await setReportResult(this.o.db, id, result);
      this.o.metrics?.finished('done', seconds());
    } catch (err) {
      const timedOut = signal.aborted;
      this.o.log?.(`check ${id} ${timedOut ? 'timed out' : 'failed'}`, err);
      await setReportFailed(this.o.db, id, timedOut ? 'timeout' : 'error').catch(() => undefined);
      this.o.metrics?.finished(timedOut ? 'timeout' : 'failed', seconds());
    }
  }
}
