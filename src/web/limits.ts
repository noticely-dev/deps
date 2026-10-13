import { createHmac } from 'node:crypto';
import { dayKey, hitLimit } from '../store/ratelimits.js';
import type { AppDeps } from './app.js';

export function ipHash(secret: string, ip: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export async function consume(deps: AppDeps, kind: 'check' | 'contact' | 'notify', ip: string, limit: number): Promise<boolean> {
  const now = (deps.clock ?? (() => new Date()))();
  const { allowed } = await hitLimit(deps.db, `${kind}:${ipHash(deps.config.IP_HASH_SECRET, ip)}:${dayKey(now)}`, limit, now);
  if (!allowed) deps.metrics?.limited(kind);
  return allowed;
}

export async function consumeGlobal(deps: AppDeps): Promise<boolean> {
  const now = (deps.clock ?? (() => new Date()))();
  const { allowed } = await hitLimit(deps.db, `global:check:${dayKey(now)}`, deps.config.GLOBAL_CHECKS_PER_DAY, now);
  if (!allowed) deps.metrics?.limited('global');
  return allowed;
}
