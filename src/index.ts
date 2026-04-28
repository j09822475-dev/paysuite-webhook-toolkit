/**
 * Public root entry for `@paysuite/webhook-toolkit`.
 *
 * Exposes the verifier factory, the multi-verifier composer, the
 * `defineWebhookProvider` helper, and core public types.
 *
 * Per-provider modules and framework adapters live behind subpath
 * exports (e.g. `./providers/stripe`, `./adapters/hono`) — DO NOT
 * re-export them here, or you will defeat tree-shaking.
 */

export { createVerifier, defineWebhookProvider, defineProvider } from './core/verifier.js';
export { createMultiVerifier } from './core/multi-verifier.js';
export type { MultiVerifierOptions, MultiVerifierEvent } from './core/multi-verifier.js';

export { WebhookError, configError, SIGNATURE_FAMILY } from './errors/index.js';
export type { ErrorCode, WebhookErrorArgs } from './errors/index.js';

export type {
  Clock,
  EventOf,
  HeaderBag,
  Logger,
  Metrics,
  NormalizedRequest,
  Provider,
  RawBodyInput,
  SignatureAlgorithm,
  VerificationResult,
  Verifier,
  VerifierInput,
  VerifierOptions,
  WebhookHandler,
  WebhookProvider,
  WebhookProviderSpec,
} from './core/types.js';
