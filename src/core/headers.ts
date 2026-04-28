import type { HeaderBag } from './types.js';

/** Internal storage: lowercased name → value (joined with ', ' for repeats). */
type Map = Record<string, string>;

function lower(name: string): string {
  return name.toLowerCase();
}

/**
 * Wrap a fetch `Headers` instance as a {@link HeaderBag}.
 *
 * @param headers - A standard `Headers` instance.
 * @returns A case-insensitive header bag.
 */
export function fromFetchHeaders(headers: Headers): HeaderBag {
  return {
    get: (name) => headers.get(name),
    has: (name) => headers.has(name),
    *entries() {
      for (const [k, v] of headers.entries()) yield [lower(k), v] as [string, string];
    },
  };
}

/**
 * Wrap a plain object (e.g. Node `IncomingHttpHeaders`) as a {@link HeaderBag}.
 *
 * Repeated headers (`Array<string>`) are joined with `', '` to match
 * fetch's `Headers#get` behavior. Case-insensitive lookup is provided.
 *
 * @param record - Object whose keys are header names (any case) and values are strings or string arrays.
 * @returns A case-insensitive header bag.
 */
export function fromRecord(
  record: Record<string, string | string[] | undefined> | undefined,
): HeaderBag {
  const map: Map = {};
  if (record) {
    for (const k of Object.keys(record)) {
      const v = record[k];
      if (v === undefined) continue;
      map[lower(k)] = Array.isArray(v) ? v.join(', ') : v;
    }
  }
  return {
    get: (name) => {
      const v = map[lower(name)];
      return v === undefined ? null : v;
    },
    has: (name) => Object.prototype.hasOwnProperty.call(map, lower(name)),
    *entries() {
      for (const k of Object.keys(map)) yield [k, map[k]!] as [string, string];
    },
  };
}

/**
 * Wrap `HeadersInit` (the union accepted by `new Headers(...)`) as a
 * {@link HeaderBag}, dispatching on the runtime shape.
 *
 * @param init - `Headers`, an entries array, or a plain object.
 * @returns A case-insensitive header bag.
 */
export function fromHeadersInit(
  init: HeadersInit | Record<string, string | string[] | undefined> | undefined,
): HeaderBag {
  if (init === undefined) return fromRecord(undefined);
  if (typeof Headers !== 'undefined' && init instanceof Headers) return fromFetchHeaders(init);
  if (Array.isArray(init)) {
    const rec: Record<string, string> = {};
    for (const [k, v] of init) rec[k] = v;
    return fromRecord(rec);
  }
  return fromRecord(init as Record<string, string | string[] | undefined>);
}
