import { MongoClient, type Db } from 'mongodb';

const DAY = 86_400;

export async function connect(url: string, dbName: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 20 });
  await client.connect();
  return { client, db: client.db(dbName) };
}

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('reports').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('packages').createIndex({ fetchedAt: 1 }, { expireAfterSeconds: DAY }),
    db.collection('advisories').createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 7 * DAY }),
    db.collection('ratelimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('subscribers').createIndex({ email: 1, list: 1 }, { unique: true }),
    db.collection('subscribers').createIndex({ tokenHash: 1 }),
    db.collection('subscribers').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('messages').createIndex({ createdAt: 1 }, { expireAfterSeconds: 180 * DAY }),
  ]);
}
