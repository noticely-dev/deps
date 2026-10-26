import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { CheckMetrics } from './check/runner.js';
import type { SourceMetrics } from './sources/index.js';
import type { AppMetrics } from './web/app.js';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'deps_' });
  const checks = new Counter({ name: 'deps_checks_total', help: 'Finished checks', labelNames: ['result'], registers: [registry] });
  const checkDuration = new Histogram({ name: 'deps_check_duration_seconds', help: 'Check duration', buckets: [0.5, 1, 2, 5, 10, 20, 30], registers: [registry] });
  const limited = new Counter({ name: 'deps_rate_limited_total', help: 'Requests refused by a rate limit', labelNames: ['kind'], registers: [registry] });
  const refused = new Counter({ name: 'deps_checks_refused_total', help: 'Checks sent back without a report', labelNames: ['reason'], registers: [registry] });
  const signups = new Counter({ name: 'deps_signups_confirmed_total', help: 'Confirmed notify-me signups', labelNames: ['list'], registers: [registry] });
  const upstream = new Counter({ name: 'deps_upstream_requests_total', help: 'Upstream API requests', labelNames: ['source', 'outcome'], registers: [registry] });
  const upstreamDuration = new Histogram({ name: 'deps_upstream_duration_seconds', help: 'Upstream request duration', labelNames: ['source'], buckets: [0.1, 0.25, 0.5, 1, 2, 5], registers: [registry] });
  const cache = new Counter({ name: 'deps_cache_lookups_total', help: 'Cache lookups', labelNames: ['result'], registers: [registry] });

  const app: AppMetrics = {
    limited: (kind) => limited.inc({ kind }),
    confirmed: (list) => signups.inc({ list }),
    refused: (reason) => refused.inc({ reason }),
    render: () => registry.metrics(),
  };
  const sources: SourceMetrics = {
    request: (source, outcome, seconds) => { upstream.inc({ source, outcome }); upstreamDuration.observe({ source }, seconds); },
    cache: (hit) => cache.inc({ result: hit ? 'hit' : 'miss' }),
  };
  const checkMetrics: CheckMetrics = {
    finished: (result, seconds) => { checks.inc({ result }); checkDuration.observe(seconds); },
  };
  return { registry, app, sources, checks: checkMetrics };
}
