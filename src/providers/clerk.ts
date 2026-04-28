import type { WebhookProvider } from '../core/types.js';
import { svixStyleProvider, type SvixEvent } from './svix.js';

/** Clerk webhook event payload (re-uses the Svix shape). */
export type ClerkEvent = SvixEvent;

/**
 * Clerk webhook provider — Clerk uses Svix under the hood, so the
 * signature format is identical to Standard Webhooks.
 *
 * @example
 * ```ts
 * import { clerk } from '@paysuite/webhook-toolkit/providers/clerk';
 * createVerifier({ provider: clerk, secret: process.env.CLERK_WEBHOOK_SECRET! });
 * ```
 */
export const clerk: WebhookProvider<ClerkEvent> = svixStyleProvider('clerk');
