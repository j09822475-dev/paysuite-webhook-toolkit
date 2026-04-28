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

  if (sweepIntervalMs > 0 && typeof globalThis.setInterval === 'function') {
    const handle = setInterval(() => sweep(map), sweepIntervalMs);
    // Don't keep the event loop alive in Node; harmless on edge runtimes.
    if (typeof (handle as { unref?: () => void }).unref === 'function') {
      (handle as { unref: () => void }).unref();
    }
  }

  return {
    putIfAbsent: async (key, ttlSeconds) => {
      const now = Date.now();
      const existing = map.get(key);
      if (existing && existing.expiresAt > now) return false;
      if (map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
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
