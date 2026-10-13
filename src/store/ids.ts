import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function newReportId(): string {
  let n = BigInt('0x' + randomBytes(16).toString('hex'));
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const REPORT_ID_RE = /^(?:[0-9A-Za-z]{22}|sample)$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
