import type { Logger } from '../core/types.js';

/**
 * Minimal pino-compatible shape. Avoids depending on `pino` itself —
 * `Logger` is a structural match, so any pino-style instance with these
 * methods works.
 */
export interface PinoLikeLogger {
  debug(meta: Record<string, unknown> | string, msg?: string): void;
  info(meta: Record<string, unknown> | string, msg?: string): void;
  warn(meta: Record<string, unknown> | string, msg?: string): void;
  error(meta: Record<string, unknown> | string, msg?: string): void;
}

/**
 * Wrap a pino-style logger as a {@link Logger}. Pino reverses the
 * `(meta, msg)` argument order relative to the library's `(msg, meta)`
 * convention, so this shim swaps them.
 *
 * @param pino - Any object exposing `debug/info/warn/error(meta, msg)`.
 * @returns A `Logger` that forwards calls to `pino`.
 *
 * @example
 * ```ts
 * import pino from 'pino';
 * import { fromPino } from '@paysuite/webhook-toolkit/logger/pino';
 * createVerifier({ provider: stripe, secret, logger: fromPino(pino()) });
 * ```
 */
export function fromPino(pino: PinoLikeLogger): Logger {
  return {
    debug: (msg, meta) => pino.debug(meta ?? {}, msg),
    info: (msg, meta) => pino.info(meta ?? {}, msg),
    warn: (msg, meta) => pino.warn(meta ?? {}, msg),
    error: (msg, meta) => pino.error(meta ?? {}, msg),
  };
}
