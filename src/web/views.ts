import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Eta } from 'eta';

export function createViews(production: boolean): Eta {
  return new Eta({ views: path.resolve('views'), autoEscape: true, cache: production });
}

// Content hash of the stylesheet and script, appended as ?v= so a deploy is never hidden behind the 1-day static cache.
export function assetVersion(): string {
  const h = createHash('sha256');
  for (const f of ['app.css', 'app.js']) h.update(readFileSync(path.resolve('public', f)));
  return h.digest('hex').slice(0, 10);
}
