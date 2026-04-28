/** Parsed Stripe-style header. `t` is `null` if absent / malformed. */
export interface StripeStyleParts {
  readonly t: number | null;
  readonly v1: ReadonlyArray<string>;
  readonly v0: ReadonlyArray<string>;
}

// `parseSignature` and `extractTimestamp` both run per request and both
// need this parse. Memoize on the raw string so providers (Stripe,
// Paddle) don't pay it twice. Bounded LRU semantics aren't necessary —
// header strings are short, and the Map is keyed on identical strings,
// not different per-request bodies — but cap size as a belt-and-braces
// guard against pathological invocation patterns.
const parseCache = new Map<string, StripeStyleParts>();
const PARSE_CACHE_MAX = 256;

/**
 * Parser for Stripe-style signature headers of the form
 * `t=<seconds>,v1=<hex>,v1=<hex>,v0=<hex>`.
 */
export const stripeStyleSignature = {
  /**
   * Parse a Stripe-style header.
   *
   * @param raw - Raw header value, e.g. `t=123,v1=abc,v1=def,v0=...`.
   * @returns `{ t, v1, v0 }`. `t` is `null` if absent / malformed.
   */
  parse(raw: string): StripeStyleParts {
    const cached = parseCache.get(raw);
    if (cached) return cached;
    const parts = raw.split(',');
    let t: number | null = null;
    const v1: string[] = [];
    const v0: string[] = [];
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      const key = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      if (key === 't') {
        const n = Number(value);
        if (Number.isFinite(n)) t = n;
      } else if (key === 'v1') {
        v1.push(value);
      } else if (key === 'v0') {
        v0.push(value);
      }
    }
    const result: StripeStyleParts = { t, v1, v0 };
    if (parseCache.size >= PARSE_CACHE_MAX) {
      const oldest = parseCache.keys().next().value;
      if (oldest !== undefined) parseCache.delete(oldest);
    }
    parseCache.set(raw, result);
    return result;
  },
};
