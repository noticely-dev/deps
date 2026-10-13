export type FetchFn = typeof fetch;
export type RequestObserver = (source: string, outcome: 'ok' | 'not_found' | 'error', seconds: number) => void;

export class UpstreamError extends Error {
  constructor(readonly source: string, readonly status: number | null, message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface GetJsonOptions {
  source: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxBytes?: number;
  body?: unknown;
  allow404?: boolean;
  observe?: RequestObserver;
}

const USER_AGENT = 'noticely-deps/1.0 (+https://deps.noticely.dev)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(fetchFn: FetchFn, url: string, o: GetJsonOptions): Promise<T | null> {
  const started = performance.now();
  const done = (outcome: 'ok' | 'not_found' | 'error') => o.observe?.(o.source, outcome, (performance.now() - started) / 1000);
  const retries = o.retries ?? 2;
  const backoff = o.backoffMs ?? 200;
  const maxBytes = o.maxBytes ?? 20 * 1024 * 1024;

  for (let attempt = 0; ; attempt++) {
    const signals = [AbortSignal.timeout(o.timeoutMs ?? 5_000)];
    if (o.signal) signals.push(o.signal);
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: o.body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(o.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        signal: AbortSignal.any(signals),
      });
    } catch (e) {
      if (o.signal?.aborted) { done('error'); throw e; }
      if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
      done('error');
      throw new UpstreamError(o.source, null, `${o.source}: ${(e as Error).message}`);
    }
    if (res.status === 404 && o.allow404) { done('not_found'); return null; }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
    if (!res.ok) { done('error'); throw new UpstreamError(o.source, res.status, `${o.source}: HTTP ${res.status}`); }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      done('error');
      throw new UpstreamError(o.source, res.status, `${o.source}: response too large`);
    }
    let text: string;
    try {
      text = await readCapped(res, maxBytes, o.source);
    } catch (e) {
      // Too large, or the caller aborted: fail now. Anything else is a body-read timeout or network error: retry like a fetch failure.
      if (e instanceof UpstreamError || o.signal?.aborted) { done('error'); throw e; }
      if (attempt < retries) { await sleep(backoff * 2 ** attempt); continue; }
      done('error');
      throw new UpstreamError(o.source, res.status, `${o.source}: ${(e as Error).message}`);
    }
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      done('error');
      throw new UpstreamError(o.source, res.status, `${o.source}: invalid JSON`);
    }
    done('ok');
    return parsed;
  }
}

/** Reads the body as text, cancelling as soon as the running total exceeds maxBytes. */
async function readCapped(res: Response, maxBytes: number, source: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new UpstreamError(source, res.status, `${source}: response too large`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type CallOptions = Omit<GetJsonOptions, 'source' | 'body' | 'allow404'>;
