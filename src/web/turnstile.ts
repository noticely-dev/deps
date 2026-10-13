import type { FetchFn } from '../sources/http.js';

export interface Turnstile {
  verify(token: string | undefined, ip: string): Promise<boolean>;
}

/** `log` gets one line per failed verification: the HTTP status or Cloudflare's error codes, never the token or IP. */
export function createTurnstile(o: { secret: string; fetch: FetchFn; log?: (msg: string) => void }): Turnstile {
  return {
    async verify(token, ip) {
      if (!token || token.length > 2048) return false;
      try {
        const res = await o.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: o.secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          o.log?.(`turnstile verify failed: HTTP ${res.status}`);
          return false;
        }
        const body = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
        if (body.success === true) return true;
        const codes = Array.isArray(body['error-codes'])
          ? body['error-codes'].filter((c): c is string => typeof c === 'string').map((c) => c.slice(0, 64))
          : [];
        o.log?.(`turnstile verify rejected: error-codes [${codes.join(', ')}]`);
        return false;
      } catch (e) {
        o.log?.(`turnstile verify failed: ${(e as Error).name}: ${(e as Error).message}`);
        return false;
      }
    },
  };
}
