import { hex, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/**
 * GitHub webhook event. The `event` field comes from `X-GitHub-Event`
 * (set by the adapter / consumer; not present in the JSON body), so the
 * library exposes the body's union — branching on `event` is conventional
 * via the request header rather than the body discriminant.
 */
export type GitHubEvent =
  | { readonly action?: string; readonly [k: string]: unknown };

/**
 * GitHub webhook provider.
 *
 * Header: `X-Hub-Signature-256: sha256=<hex>`. Signs the raw body. No
 * timestamp signed (replay handled at the idempotency layer via
 * `X-GitHub-Delivery`).
 *
 * @example
 * ```ts
 * import { github } from '@paysuite/webhook-toolkit/providers/github';
 * createVerifier({ provider: github, secret: process.env.GITHUB_WEBHOOK_SECRET! });
 * ```
 */
export const github: WebhookProvider<GitHubEvent> = {
  id: 'github',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('x-hub-signature-256');
    if (!raw) return null;
    const value = raw.startsWith('sha256=') ? raw.slice('sha256='.length) : raw;
    return { signatures: [hex.decode(value)], raw };
  },

  extractTimestamp: () => null,

  buildSigningString: ({ rawBody }) => rawBody,

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as GitHubEvent,

  idempotencyKey: (input) => input.headers.get('x-github-delivery'),
};
