import { describe, expect, it } from 'vitest';
import { parseArea, parseDecimal, parseLength } from './numberParse';

describe('parseDecimal', () => {
  it.each([
    ['3.5', 3.5],
    ['3,5', 3.5],
    ['1,200.5', 1200.5],
    ['1.200,50', 1200.5],
    ['1 200', 1200],
    ['1 200,75', 1200.75],
    ['1,500', 1.5], // EU habit: single comma stays decimal; UI echo catches US intent
    ['1,500.25', 1500.25],
    ['1.000.000', 1000000],
    ['1,000,000', 1000000],
    ['-4,2', -4.2],
  ])('parses %s → %d', (input, expected) => {
    expect(parseDecimal(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('1.2.3,4,5')).toBeNull();
  });
});

describe('parseLength', () => {
  it('uses the display system for bare numbers', () => {
    expect(parseLength('3.5', 'metric')).toEqual({ ok: true, value: 3500 });
    expect(parseLength('10', 'imperial')).toEqual({ ok: true, value: 3048 });
  });

  it('parses explicit units regardless of system', () => {
    expect(parseLength('3500mm', 'imperial')).toEqual({ ok: true, value: 3500 });
    expect(parseLength('3.5 m', 'imperial')).toEqual({ ok: true, value: 3500 });
    expect(parseLength('350 cm', 'metric')).toEqual({ ok: true, value: 3500 });
  });

  it('parses compound metric: 3m 20 → 3.2 m', () => {
    expect(parseLength('3m 20', 'metric')).toEqual({ ok: true, value: 3200 });
    expect(parseLength('3 m 20 cm', 'metric')).toEqual({ ok: true, value: 3200 });
  });

  it("parses feet-inches: 12'6\"", () => {
    expect(parseLength(`12'6"`, 'imperial')).toEqual({ ok: true, value: Math.round(12 * 304.8 + 6 * 25.4) });
    expect(parseLength('12ft 6in', 'metric')).toEqual({ ok: true, value: Math.round(12 * 304.8 + 6 * 25.4) });
  });

  it('errors instead of silently returning 0', () => {
    expect(parseLength('big', 'metric').ok).toBe(false);
    expect(parseLength('3 bananas', 'metric').ok).toBe(false);
    expect(parseLength('12 m²', 'metric').ok).toBe(false);
  });
});

describe('parseArea', () => {
  it('uses the display system default unit', () => {
    expect(parseArea('12.5', 'metric')).toEqual({ ok: true, value: 12_500_000 });
    expect(parseArea('100', 'imperial')).toEqual({ ok: true, value: Math.round(100 * 92_903.04) });
  });

  it('parses explicit area units', () => {
    expect(parseArea('12,5 m²', 'imperial')).toEqual({ ok: true, value: 12_500_000 });
    expect(parseArea('350 sqft', 'metric')).toEqual({ ok: true, value: Math.round(350 * 92_903.04) });
  });

  it('rejects lengths and garbage', () => {
    expect(parseArea('3 m', 'metric').ok).toBe(false);
    expect(parseArea('x', 'metric').ok).toBe(false);
  });
});
