import type { Db, ObjectId } from 'mongodb';

export interface NewMessage { name: string; email: string; company: string; message: string; reportId: string | null; createdAt: Date }

export async function saveMessage(db: Db, m: NewMessage): Promise<ObjectId> {
  const res = await db.collection('messages').insertOne({ ...m, emailSent: false });
  return res.insertedId;
}

export async function markMessageSent(db: Db, id: ObjectId): Promise<void> {
  await db.collection('messages').updateOne({ _id: id }, { $set: { emailSent: true } });
}
