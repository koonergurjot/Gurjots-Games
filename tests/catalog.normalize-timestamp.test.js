import { describe, expect, it } from 'vitest';
import { normalizeTimestamp } from '../js/catalog-utils.js';

const FEB_1_2024 = Date.UTC(2024, 1, 1);

describe('normalizeTimestamp', () => {
  it('parses compact YYYYMMDD strings', () => {
    expect(normalizeTimestamp('20240201')).toBe(FEB_1_2024);
  });

  it('parses compact YYYYMMDD numbers', () => {
    expect(normalizeTimestamp(20240201)).toBe(FEB_1_2024);
  });

  it('ignores invalid compact dates', () => {
    expect(normalizeTimestamp('20240231')).toBe(0);
    expect(normalizeTimestamp(20240231)).toBe(0);
  });

  it('preserves behaviour for epoch seconds', () => {
    const epochSeconds = 1706745600; // 2024-02-01T00:00:00Z
    expect(normalizeTimestamp(epochSeconds)).toBe(epochSeconds * 1000);
  });
});
