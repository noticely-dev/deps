import type { Collection } from 'mongodb';

export interface CacheStore {
  get<T>(key: string): Promise<{ value: T } | null>;
  set<T>(key: string, value: T): Promise<void>;
}

export interface CacheDoc {
  _id: string;
  value: unknown;
  fetchedAt: Date;
}

export function mongoCache(coll: Collection<CacheDoc>): CacheStore {
  return {
    async get<T>(key: string) {
      const doc = await coll.findOne({ _id: key });
      return doc ? { value: doc.value as T } : null;
    },
    async set<T>(key: string, value: T) {
      await coll.replaceOne({ _id: key }, { value, fetchedAt: new Date() }, { upsert: true });
    },
  };
}

export function memoryCache(): CacheStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.has(key) ? { value: map.get(key) as T } : null;
    },
    async set<T>(key: string, value: T) {
      map.set(key, value);
    },
  };
}
