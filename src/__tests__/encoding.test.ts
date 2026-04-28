import { describe, expect, it } from 'vitest';
import { base64, base64url, concat, hex, utf8 } from '../core/encoding.js';

describe('hex', () => {
  it('should encode bytes to lowercase hex when given binary input', () => {
    expect(hex.encode(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
  });

  it('should return empty string when encoding empty array', () => {
    expect(hex.encode(new Uint8Array(0))).toBe('');
  });

  it('should round-trip arbitrary bytes when encoded and decoded', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const out = hex.decode(hex.encode(bytes));
    expect(out).toEqual(bytes);
  });

  it('should accept upper-case input when decoding', () => {
    expect(hex.decode('DEAD')).toEqual(new Uint8Array([0xde, 0xad]));
  });

  it('should throw when decoding odd-length string', () => {
    expect(() => hex.decode('abc')).toThrow(/odd length/);
  });

  it('should throw when decoding non-hex character', () => {
    expect(() => hex.decode('zz')).toThrow(/invalid character/);
  });
});

describe('base64', () => {
  it('should encode standard alphabet with padding when given input', () => {
    expect(base64.encode(new Uint8Array([1, 2, 3]))).toBe('AQID');
  });

  it('should round-trip random bytes when encoded and decoded', () => {
    const bytes = new Uint8Array(120);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
    expect(base64.decode(base64.encode(bytes))).toEqual(bytes);
  });

  it('should pad single-byte input correctly', () => {
    const enc = base64.encode(new Uint8Array([0x66]));
    expect(enc).toBe('Zg==');
    expect(base64.decode(enc)).toEqual(new Uint8Array([0x66]));
  });

  it('should pad two-byte input correctly', () => {
    const enc = base64.encode(new Uint8Array([0x66, 0x6f]));
    expect(enc).toBe('Zm8=');
    expect(base64.decode(enc)).toEqual(new Uint8Array([0x66, 0x6f]));
  });

  it('should accept missing padding when decoding', () => {
    expect(base64.decode('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64.decode('Zg')).toEqual(new Uint8Array([0x66]));
    expect(base64.decode('Zm8')).toEqual(new Uint8Array([0x66, 0x6f]));
  });

  it('should accept URL-safe alphabet on input when decoding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const std = base64.encode(bytes);
    const urlSafe = std.replace(/\+/g, '-').replace(/\//g, '_');
    expect(base64.decode(urlSafe)).toEqual(bytes);
  });

  it('should throw when decoding string with invalid length tail', () => {
    expect(() => base64.decode('A')).toThrow(/invalid length/);
  });

  it('should throw when decoding contains invalid character', () => {
    expect(() => base64.decode('!@#$')).toThrow(/invalid character/);
  });
});

describe('base64url', () => {
  it('should encode without padding when given input', () => {
    expect(base64url.encode(new Uint8Array([1, 2, 3]))).toBe('AQID');
    expect(base64url.encode(new Uint8Array([0x66]))).toBe('Zg');
  });

  it('should use URL-safe alphabet when bytes contain - or _ slots', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
    const urlSafe = base64url.encode(bytes);
    expect(urlSafe).not.toContain('+');
    expect(urlSafe).not.toContain('/');
    expect(urlSafe).not.toContain('=');
    expect(base64url.decode(urlSafe)).toEqual(bytes);
  });
});

describe('utf8', () => {
  it('should encode ASCII when given simple string', () => {
    expect(utf8.encode('hello')).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  it('should round-trip multi-byte chars when encoded and decoded', () => {
    const s = 'héllo, 世界 🌍';
    expect(utf8.decode(utf8.encode(s))).toBe(s);
  });

  it('should not throw on invalid UTF-8 when decoding', () => {
    // Lone continuation byte — replaced, not thrown.
    expect(() => utf8.decode(new Uint8Array([0xff, 0xfe]))).not.toThrow();
  });
});

describe('concat', () => {
  it('should join multiple arrays in order when called', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4, 5]);
    const c = new Uint8Array([6]);
    expect(concat(a, b, c)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('should return empty array when called with no inputs', () => {
    expect(concat()).toEqual(new Uint8Array(0));
  });

  it('should handle empty arrays gracefully when interleaved', () => {
    expect(concat(new Uint8Array(0), new Uint8Array([1]), new Uint8Array(0))).toEqual(
      new Uint8Array([1]),
    );
  });
});
