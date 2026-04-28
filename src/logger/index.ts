import type { Logger } from '../core/types.js';

export type { Logger } from '../core/types.js';

/**
 * No-op logger; the verifier's default. Drops every message.
 */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * `console`-backed logger. Useful for local development and CI logs.
 *
 * @example
 * ```ts
 * import { consoleLogger } from '@paysuite/webhook-toolkit/logger';
 * createVerifier({ provider: stripe, secret, logger: consoleLogger });
 * ```
 */
export const consoleLogger: Logger = {
  debug: (msg, meta) => console.debug(msg, meta),
  info: (msg, meta) => console.info(msg, meta),
  warn: (msg, meta) => console.warn(msg, meta),
  error: (msg, meta) => console.error(msg, meta),
};
