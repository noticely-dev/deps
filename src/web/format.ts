const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const RING_R = 38;
const CIRC = 2 * Math.PI * RING_R;

export function formatDownloads(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export function formatMonth(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function scorecardBar(score: number | null): string {
  if (score === null) return '';
  const w = Math.max(0, Math.min(10, Math.round(score)));
  const tone = score >= 7 ? '' : score >= 4 ? ' mid' : ' bad';
  return `bar${tone} w${w}`;
}

export function ringDash(score: number): { dash: number; gap: number } {
  const dash = (Math.max(0, Math.min(100, score)) / 100) * CIRC;
  return { dash, gap: CIRC - dash };
}
