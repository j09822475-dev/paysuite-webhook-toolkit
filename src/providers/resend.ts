import type { WebhookProvider } from '../core/types.js';
import { svixStyleProvider, type SvixEvent } from './svix.js';

/** Resend webhook event payload (re-uses the Svix shape). */
export type ResendEvent = SvixEvent;

/**
 * Resend webhook provider — Resend uses Svix.
 *
 * @example
 * ```ts
 * import { resend } from '@paysuite/webhook-toolkit/providers/resend';
 * createVerifier({ provider: resend, secret: process.env.RESEND_WEBHOOK_SECRET! });
 * ```
 */
export const resend: WebhookProvider<ResendEvent> = svixStyleProvider('resend');
