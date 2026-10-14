import type { Db } from 'mongodb';

const TTL_MS = 48 * 3_600_000;

interface LimitDoc { _id: string; count: number; expiresAt: Date }

export async function hitLimit(db: Db, key: string, limit: number, now: Date, retry = true): Promise<{ allowed: boolean; count: number }> {
  try {
    const doc = await db.collection<LimitDoc>('ratelimits').findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + TTL_MS) } },
      { upsert: true, returnDocument: 'after' },
    );
    const count = doc?.count ?? 1;
    return { allowed: count <= limit, count };
  } catch (e) {
    // Two concurrent first hits can both try to insert the same _id; the loser retries as an update.
    if (retry && (e as { code?: number }).code === 11000) return hitLimit(db, key, limit, now, false);
    throw e;
  }
}

export async function releaseLimit(db: Db, key: string): Promise<void> {
  await db.collection<LimitDoc>('ratelimits').updateOne({ _id: key, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
