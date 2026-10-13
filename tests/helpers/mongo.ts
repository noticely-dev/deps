import { randomBytes } from 'node:crypto';
import { connect, ensureIndexes } from '../../src/store/db.js';

export async function testDb() {
  const { client, db } = await connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017', `test_${randomBytes(6).toString('hex')}`);
  await ensureIndexes(db);
  return {
    db,
    async close() {
      await db.dropDatabase();
      await client.close();
    },
  };
}
