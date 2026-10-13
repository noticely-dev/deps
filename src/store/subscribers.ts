import type { Db } from 'mongodb';

export type List = 'pdf' | 'pack';
const PENDING_TTL_MS = 7 * 86_400_000;
const UNSUB_TTL_MS = 30 * 86_400_000;
const RESEND_AFTER_MS = 86_400_000;

interface SubscriberDoc {
  email: string;
  list: List;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  tokenHash: string;
  createdAt: Date;
  confirmedAt?: Date;
  sentAt?: Date;
  expiresAt?: Date;
}

const subs = (db: Db) => db.collection<SubscriberDoc>('subscribers');

export async function requestSignup(db: Db, email: string, list: List, tokenHash: string, now: Date): Promise<'pending' | 'confirmed' | 'already-pending'> {
  const existing = await subs(db).findOne({ email, list });
  if (existing?.status === 'confirmed') return 'confirmed';
  if (existing?.status === 'pending' && existing.expiresAt && existing.expiresAt > now
    && existing.sentAt && now.getTime() - existing.sentAt.getTime() < RESEND_AFTER_MS) return 'already-pending';
  await subs(db).updateOne(
    { email, list },
    { $set: { status: 'pending', tokenHash, sentAt: now, expiresAt: new Date(now.getTime() + PENDING_TTL_MS) }, $setOnInsert: { createdAt: now }, $unset: { confirmedAt: '' } },
    { upsert: true },
  );
  return 'pending';
}

export async function confirmSignup(db: Db, tokenHash: string, now: Date): Promise<{ result: 'confirmed' | 'already' | 'invalid'; list?: List }> {
  const doc = await subs(db).findOneAndUpdate(
    { tokenHash, status: 'pending', expiresAt: { $gt: now } },
    { $set: { status: 'confirmed', confirmedAt: now }, $unset: { expiresAt: '' } },
    { returnDocument: 'after' },
  );
  if (doc) return { result: 'confirmed', list: doc.list };
  const other = await subs(db).findOne({ tokenHash });
  return other?.status === 'confirmed' ? { result: 'already', list: other.list } : { result: 'invalid' };
}

export async function unsubscribe(db: Db, tokenHash: string, now: Date): Promise<'ok' | 'invalid'> {
  const res = await subs(db).updateOne(
    { tokenHash, status: { $in: ['pending', 'confirmed'] } },
    { $set: { status: 'unsubscribed', expiresAt: new Date(now.getTime() + UNSUB_TTL_MS) } },
  );
  if (res.matchedCount) return 'ok';
  return (await subs(db).findOne({ tokenHash, status: 'unsubscribed' })) ? 'ok' : 'invalid';
}

/** Read-only lookup for the GET pages: mail scanners prefetch links, so only POST may change anything. */
export function findByToken(db: Db, tokenHash: string): Promise<Pick<SubscriberDoc, 'status' | 'list' | 'expiresAt'> | null> {
  return subs(db).findOne({ tokenHash }, { projection: { _id: 0, status: 1, list: 1, expiresAt: 1 } });
}
