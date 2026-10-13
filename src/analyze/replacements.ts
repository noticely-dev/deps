import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Replacement } from './types.js';

const Schema = z.record(z.string().min(1), z.strictObject({
  suggestion: z.string().min(1).max(120),
  effort: z.enum(['patch', 'rename', 'major', 'replace', 'watch']),
}));

export function loadReplacements(file: string): Record<string, Replacement> {
  const parsed = Schema.parse(JSON.parse(readFileSync(file, 'utf8')));
  return Object.assign(Object.create(null) as Record<string, Replacement>, parsed);
}
