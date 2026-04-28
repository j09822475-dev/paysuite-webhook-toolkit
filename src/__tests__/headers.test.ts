import { describe, expect, it } from 'vitest';
import { fromFetchHeaders, fromHeadersInit, fromRecord } from '../core/headers.js';

describe('fromFetchHeaders', () => {
  it('should expose case-insensitive get when wrapping fetch Headers', () => {
    const h = fromFetchHeaders(new Headers({ 'X-Test': 'one' }));
    expect(h.get('x-test')).toBe('one');
    expect(h.get('X-TEST')).toBe('one');
    expect(h.get('missing')).toBeNull();
    expect(h.has('X-Test')).toBe(true);
    expect(h.has('missing')).toBe(false);
  });

  it('should yield lowercased entries when iterated', () => {
    const h = fromFetchHeaders(new Headers({ 'Content-Type': 'application/json' }));
    const entries = [...h.entries()];
    expect(entries).toContainEqual(['content-type', 'application/json']);
  });
});

describe('fromRecord', () => {
  it('should join array values with comma and space when given repeated headers', () => {
    const h = fromRecord({ 'Set-Cookie': ['a=1', 'b=2'] });
    expect(h.get('set-cookie')).toBe('a=1, b=2');
  });

  it('should ignore undefined values when populating bag', () => {
    const h = fromRecord({ 'X-Defined': 'yes', 'X-Missing': undefined });
    expect(h.get('x-defined')).toBe('yes');
    expect(h.has('x-missing')).toBe(false);
  });

  it('should return null when key is absent', () => {
    expect(fromRecord({}).get('any')).toBeNull();
  });

  it('should accept undefined input when called', () => {
    const h = fromRecord(undefined);
    expect(h.has('anything')).toBe(false);
    expect([...h.entries()]).toEqual([]);
  });

  it('should perform case-insensitive lookups when called with mixed case', () => {
    const h = fromRecord({ 'x-Foo': 'v' });
    expect(h.get('X-FOO')).toBe('v');
    expect(h.has('x-FOO')).toBe(true);
  });
});

describe('fromHeadersInit', () => {
  it('should dispatch to fromRecord when input is undefined', () => {
    const h = fromHeadersInit(undefined);
    expect(h.has('x')).toBe(false);
  });

  it('should dispatch to fromFetchHeaders when given a Headers instance', () => {
    const h = fromHeadersInit(new Headers({ 'X-A': '1' }));
    expect(h.get('x-a')).toBe('1');
  });

  it('should accept an entries array when given [name, value][]', () => {
    const h = fromHeadersInit([
      ['x-a', '1'],
      ['x-b', '2'],
    ]);
    expect(h.get('x-a')).toBe('1');
    expect(h.get('x-b')).toBe('2');
  });

  it('should accept a plain record when given { name: value }', () => {
    const h = fromHeadersInit({ 'X-A': '1' });
    expect(h.get('x-a')).toBe('1');
  });
});
