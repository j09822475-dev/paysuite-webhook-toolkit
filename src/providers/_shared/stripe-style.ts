/**
 * Parser for Stripe-style signature headers of the form
 * `t=<seconds>,v1=<hex>,v1=<hex>,v0=<hex>`.
 *
 * Returns the timestamp (seconds; consumer multiplies by 1000) and every
 * `v1` / `v0` hex signature so the core verifier can iterate × the
 * `secret` rotation list.
 */
export const stripeStyleSignature = {
  /**
   * Parse a Stripe-style header.
   *
   * @param raw - Raw header value, e.g. `t=123,v1=abc,v1=def,v0=...`.
   * @returns `{ t: number | null, v1: string[], v0: string[] }`.
   *           `t` is `null` if absent / malformed; signatures are hex strings.
   */
  parse(raw: string): { t: number | null; v1: string[]; v0: string[] } {
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
    return { t, v1, v0 };
  },
};
