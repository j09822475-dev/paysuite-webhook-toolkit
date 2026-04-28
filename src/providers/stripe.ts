import { hex, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';
import { stripeStyleSignature } from './_shared/stripe-style.js';

/**
 * Curated Stripe event union. Library ships ~30 most-common types;
 * unknown types fall through to the generic `{ type: string; … }` shape.
 * Users may declaration-merge to add custom types.
 */
export interface StripePaymentIntent {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly [k: string]: unknown;
}

export interface StripeCharge {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly [k: string]: unknown;
}

export interface StripeCheckoutSession {
  readonly id: string;
  readonly customer: string | null;
  readonly [k: string]: unknown;
}

/** Stripe-shaped event. Discriminated by `type`. */
export type StripeEvent =
  | { readonly type: 'payment_intent.succeeded'; readonly id: string; readonly data: { readonly object: StripePaymentIntent } }
  | { readonly type: 'payment_intent.payment_failed'; readonly id: string; readonly data: { readonly object: StripePaymentIntent } }
  | { readonly type: 'payment_intent.canceled'; readonly id: string; readonly data: { readonly object: StripePaymentIntent } }
  | { readonly type: 'charge.succeeded'; readonly id: string; readonly data: { readonly object: StripeCharge } }
  | { readonly type: 'charge.refunded'; readonly id: string; readonly data: { readonly object: StripeCharge } }
  | { readonly type: 'charge.failed'; readonly id: string; readonly data: { readonly object: StripeCharge } }
  | { readonly type: 'checkout.session.completed'; readonly id: string; readonly data: { readonly object: StripeCheckoutSession } }
  | { readonly type: 'checkout.session.async_payment_succeeded'; readonly id: string; readonly data: { readonly object: StripeCheckoutSession } }
  | { readonly type: 'checkout.session.async_payment_failed'; readonly id: string; readonly data: { readonly object: StripeCheckoutSession } }
  | { readonly type: 'invoice.paid'; readonly id: string; readonly data: { readonly object: Record<string, unknown> } }
  | { readonly type: 'invoice.payment_failed'; readonly id: string; readonly data: { readonly object: Record<string, unknown> } }
  | { readonly type: 'customer.subscription.created'; readonly id: string; readonly data: { readonly object: Record<string, unknown> } }
  | { readonly type: 'customer.subscription.updated'; readonly id: string; readonly data: { readonly object: Record<string, unknown> } }
  | { readonly type: 'customer.subscription.deleted'; readonly id: string; readonly data: { readonly object: Record<string, unknown> } }
  | { readonly type: string; readonly id: string; readonly data: { readonly object: Record<string, unknown> } };

/**
 * Stripe webhook provider.
 *
 * Implements the strategy contract:
 * - `parseSignature` extracts every `v1=…` from `Stripe-Signature` so the
 *   core verifier can iterate them × the secret rotation list.
 * - `extractTimestamp` reads `t=` and converts seconds → milliseconds.
 * - `buildSigningString` concatenates `${t}.${rawBody}`.
 * - `parseEvent` JSON-decodes the verified bytes once.
 *
 * The core verifier owns timing-safe equality, replay enforcement, and
 * body-size limits.
 *
 * @example
 * ```ts
 * import { createVerifier } from '@paysuite/webhook-toolkit';
 * import { stripe } from '@paysuite/webhook-toolkit/providers/stripe';
 * const verifier = createVerifier({ provider: stripe, secret: process.env.STRIPE_SECRET! });
 * ```
 */
export const stripe: WebhookProvider<StripeEvent> = {
  id: 'stripe',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('stripe-signature');
    if (!raw) return null;
    const parts = stripeStyleSignature.parse(raw);
    if (parts.v1.length === 0) return null;
    const signatures: Uint8Array[] = [];
    for (const s of parts.v1) {
      try {
        signatures.push(hex.decode(s));
      } catch {
        // Skip malformed entries so a single bad v1 in a rotation list
        // doesn't reject an otherwise verifiable signature.
      }
    }
    if (signatures.length === 0) return null;
    return { signatures, raw };
  },

  extractTimestamp: (headers) => {
    const raw = headers.get('stripe-signature');
    if (!raw) return null;
    const t = stripeStyleSignature.parse(raw).t;
    return t !== null && Number.isFinite(t) ? t * 1000 : null;
  },

  buildSigningString: ({ rawBody, timestamp }) => {
    const seconds = Math.floor((timestamp ?? 0) / 1000);
    const tsBytes = utf8.encode(`${String(seconds)}.`);
    const out = new Uint8Array(tsBytes.length + rawBody.length);
    out.set(tsBytes, 0);
    out.set(rawBody, tsBytes.length);
    return out;
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as StripeEvent,

  idempotencyKey: (_input, event) => event.id ?? null,
};
