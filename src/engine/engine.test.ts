import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index';

describe('engine smoke', () => {
  it('loads under node environment (no DOM dependency)', () => {
    expect(ENGINE_VERSION).toBe(1);
    expect(typeof globalThis.document).toBe('undefined');
  });
});
