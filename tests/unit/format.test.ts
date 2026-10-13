import { describe, expect, it } from 'vitest';
import { formatDownloads, formatMonth, ringDash, scorecardBar } from '../../src/web/format.js';

describe('format', () => {
  it.each([[null, '—'], [950, '950'], [12_400, '12.4k'], [1_100_000, '1.1M'], [58_200_000, '58.2M']])('downloads %s', (n, s) => {
    expect(formatDownloads(n)).toBe(s);
  });
  it('formats months and scorecards', () => {
    expect(formatMonth('2021-02-20T10:00:00Z')).toBe('Feb 2021');
    expect(formatMonth(null)).toBe('—');
    expect(scorecardBar(8.5)).toBe('bar w9');
    expect(scorecardBar(5.5)).toBe('bar mid w6');
    expect(scorecardBar(2.4)).toBe('bar bad w2');
    expect(scorecardBar(null)).toBe('');
  });
  it('computes the score ring', () => {
    const { dash, gap } = ringDash(58);
    expect(Math.round(dash + gap)).toBe(239); // circumference for r=38
    expect(Math.round(dash)).toBe(138); // 58% of 238.76
  });
});
