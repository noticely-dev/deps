import { createHmac } from 'node:crypto';
import { dayKey, hitLimit, releaseLimit } from '../store/ratelimits.js';
import type { AppDeps } from './app.js';

export function ipHash(secret: string, ip: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

type Kind = 'check' | 'contact' | 'notify';
const now = (deps: AppDeps) => (deps.clock ?? (() => new Date()))();
const ipKey = (deps: AppDeps, kind: Kind, ip: string) => `${kind}:${ipHash(deps.config.IP_HASH_SECRET, ip)}:${dayKey(now(deps))}`;
const globalKey = (deps: AppDeps) => `global:check:${dayKey(now(deps))}`;

export async function consume(deps: AppDeps, kind: Kind, ip: string, limit: number): Promise<boolean> {
  const { allowed } = await hitLimit(deps.db, ipKey(deps, kind, ip), limit, now(deps));
  if (!allowed) deps.metrics?.limited(kind);
  return allowed;
}

export async function consumeGlobal(deps: AppDeps): Promise<boolean> {
  const { allowed } = await hitLimit(deps.db, globalKey(deps), deps.config.GLOBAL_CHECKS_PER_DAY, now(deps));
  if (!allowed) deps.metrics?.limited('global');
  return allowed;
}

/** Gives back a check that was charged but never ran (the service was busy or at capacity). */
export async function refund(deps: AppDeps, kind: Kind, ip: string): Promise<void> {
  await releaseLimit(deps.db, ipKey(deps, kind, ip));
}

export async function refundGlobal(deps: AppDeps): Promise<void> {
  await releaseLimit(deps.db, globalKey(deps));
}
