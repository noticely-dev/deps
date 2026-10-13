import { z } from 'zod';

const DEV_SITE_KEY = '1x00000000000000000000AA';
const DEV_SECRET = '1x0000000000000000000000000000000AA';
const DEV_HASH_SECRET = 'dev-only-secret-change-me';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  MONGO_URL: z.string().min(1).default('mongodb://localhost:27017'),
  MONGO_DB: z.string().min(1).default('deps'),
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  TURNSTILE_SITE_KEY: z.string().min(1).default(DEV_SITE_KEY),
  TURNSTILE_SECRET: z.string().min(1).default(DEV_SECRET),
  RESEND_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().min(3).default('noticely <hello@noticely.dev>'),
  CONTACT_TO: z.string().default(''),
  IP_HASH_SECRET: z.string().min(16).default(DEV_HASH_SECRET),
  CHECKS_PER_DAY: z.coerce.number().int().positive().default(5),
  GLOBAL_CHECKS_PER_DAY: z.coerce.number().int().positive().default(500),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = Env.parse(env);
  if (cfg.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (cfg.IP_HASH_SECRET === DEV_HASH_SECRET) problems.push('IP_HASH_SECRET');
    if (cfg.TURNSTILE_SECRET === DEV_SECRET || cfg.TURNSTILE_SITE_KEY === DEV_SITE_KEY) problems.push('TURNSTILE_*');
    if (!cfg.RESEND_API_KEY) problems.push('RESEND_API_KEY');
    if (!cfg.CONTACT_TO) problems.push('CONTACT_TO');
    if (!cfg.PUBLIC_URL.startsWith('https://')) problems.push('PUBLIC_URL');
    if (problems.length) throw new Error(`Production config incomplete: ${problems.join(', ')}`);
  }
  return cfg;
}
