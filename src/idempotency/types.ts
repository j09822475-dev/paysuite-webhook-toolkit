/**
 * Pluggable idempotency-store contract. Implementations: in-memory
 * (default), Redis (`SET NX EX`), Cloudflare KV (CAS), D1 (UNIQUE index),
 * Upstash, DynamoDB (`ConditionExpression: attribute_not_exists`).
 */
export interface IdempotencyStore {
  /**
   * Atomically insert `key` with `ttlSeconds`. MUST be atomic across
   * replicas — the entire correctness of `withIdempotency` rests on this
   * primitive.
   *
   * @param key         - Namespaced idempotency key (e.g. `'stripe:evt_1'`).
   * @param ttlSeconds  - Time-to-live in seconds.
   * @returns `true` if the key was newly inserted, `false` if it already existed.
   */
  putIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Optional — store a cached response body for `'replay-cached'` mode.
   *
   * @param key         - Idempotency key.
   * @param value       - Response bytes to cache.
   * @param ttlSeconds  - Time-to-live in seconds.
   */
  saveResult?(key: string, value: Uint8Array, ttlSeconds: number): Promise<void>;

  /**
   * Optional — fetch a previously cached response body.
   *
   * @param key - Idempotency key.
   * @returns Cached bytes, or `null` if absent.
   */
  getResult?(key: string): Promise<Uint8Array | null>;
}

/** A single store entry; useful for store implementations to share. */
export interface IdempotencyRecord {
  readonly key: string;
  readonly expiresAt: number;
  readonly result?: Uint8Array;
}
