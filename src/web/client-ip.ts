import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/** Cloudflare sets CF-Connecting-IP; port 443 only accepts Cloudflare's ranges, so the header is trusted. */
export function clientIp(req: FastifyRequest): string {
  const h = req.headers['cf-connecting-ip'];
  const v = Array.isArray(h) ? h[0] : h;
  return v && isIP(v.trim()) ? v.trim() : req.ip;
}
