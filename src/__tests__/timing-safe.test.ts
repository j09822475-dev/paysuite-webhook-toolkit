import { describe, expect, it } from 'vitest';
import { timingSafeEqual } from '../core/timing-safe.js';

describe('timingSafeEqual', () => {
  it('should return true when arrays are byte-identical', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(timingSafeEqual(a, b)).toBe(true);
  });

  it('should return false when arrays differ in any byte', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('should return false when lengths differ', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('should return true when both arrays are empty', () => {
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('should return false when only the first byte differs', () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    b[0] = 1;
    expect(timingSafeEqual(a, b)).toBe(false);
  });

  it('should return false when only the last byte differs', () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    b[31] = 1;
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});
