import type { IdempotencyStore } from './types.js';

interface Entry {
  expiresAt: number;
  result?: Uint8Array;
}

/** Options for {@link memoryStore}. */
export interface MemoryStoreOptions {
  /** Default TTL (seconds) when none is supplied to `putIfAbsent`. */
  readonly defaultTtlSeconds?: number;
  /** How often (ms) to sweep expired entries. Default `60_000`. Pass `0` to disable. */
  readonly sweepIntervalMs?: number;
  /** Hard cap on entries; when exceeded, the oldest are dropped. Default `100_000`. */
  readonly maxEntries?: number;
}

/**
 * In-memory idempotency store. Suitable for tests, single-process
 * deployments, or as a baseline before wiring a Redis/KV backend.
 *
 * Sweeping is best-effort; expiry is also enforced lazily on read.
 *
 * @param options - Tuning knobs.
 * @returns An {@link IdempotencyStore}.
 *
 * @example
 * ```ts
 * import { memoryStore } from '@paysuite/webhook-toolkit/idempotency';
 * const store = memoryStore({ defaultTtlSeconds: 86_400 });
 * ```
 */
export function memoryStore(options: MemoryStoreOptions = {}): IdempotencyStore {
  const map = new Map<string, Entry>();
  const maxEntries = options.maxEntries ?? 100_000;
  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;

  // Lazy interval start: importing `memoryStore` from a Cloudflare Worker
  // (where `setInterval` is a no-op or warning at module-load time)
  // shouldn't trigger any side-effect. The interval is created on the
  // first `putIfAbsent` instead, which only happens once a request lands.
  let sweepStarted = false;
  const startSweep = (): void => {
    if (sweepStarted) return;
    sweepStarted = true;
    if (sweepIntervalMs <= 0 || typeof globalThis.setInterval !== 'function') return;
    const handle = setInterval(() => sweep(map), sweepIntervalMs);
    if (typeof (handle as { unref?: () => void }).unref === 'function') {
      (handle as { unref: () => void }).unref();
    }
  };

  return {
    putIfAbsent: async (key, ttlSeconds) => {
      startSweep();
      const now = Date.now();
      const existing = map.get(key);
      if (existing && existing.expiresAt > now) return false;
      if (map.size >= maxEntries) evictOne(map, now);
      map.set(key, { expiresAt: now + ttlSeconds * 1000 });
      return true;
    },

    saveResult: async (key, value, ttlSeconds) => {
      const now = Date.now();
      map.set(key, { expiresAt: now + ttlSeconds * 1000, result: value });
    },

    getResult: async (key) => {
      const entry = map.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      return entry.result ?? null;
    },
  };
}

function sweep(map: Map<string, Entry>): void {
  const now = Date.now();
  for (const [k, v] of map) {
    if (v.expiresAt <= now) map.delete(k);
  }
}

// Eviction prefers expired entries over the oldest-by-insertion. Walks at
// most 32 entries: keeps eviction O(1)-ish under the cap while avoiding
// the pathological case where bursty short-TTL entries get retained while
// older still-valid ones are dropped. If no expired entry is found in the
// window, fall back to FIFO (oldest insertion).
function evictOne(map: Map<string, Entry>, now: number): void {
  const SCAN = 32;
  let i = 0;
  let oldest: string | undefined;
  for (const [k, v] of map) {
    if (oldest === undefined) oldest = k;
    if (v.expiresAt <= now) {
      map.delete(k);
      return;
    }
    if (++i >= SCAN) break;
  }
  if (oldest !== undefined) map.delete(oldest);
}
