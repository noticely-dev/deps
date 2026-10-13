import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (secret: string, ms: string) => createHmac('sha256', secret).update(`form:${ms}`).digest('hex').slice(0, 32);

export function issueFormTime(secret: string, now: Date): string {
  const ms = String(now.getTime());
  return `${ms}.${sign(secret, ms)}`;
}

export function checkFormTime(secret: string, value: string | undefined, now: Date, minMs = 3_000, maxMs = 86_400_000): boolean {
  const m = /^(\d{10,16})\.([0-9a-f]{32})$/.exec(value ?? '');
  if (!m) return false;
  const [, ms = '', mac = ''] = m;
  const expected = Buffer.from(sign(secret, ms));
  if (!timingSafeEqual(expected, Buffer.from(mac))) return false;
  const age = now.getTime() - Number(ms);
  return age >= minMs && age <= maxMs;
}
