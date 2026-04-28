import type { Router, RouterHandler } from './types.js';

export type { Router, RouterHandler } from './types.js';

type AnyHandler = (event: { readonly type: string }) => Promise<void> | void;

/**
 * Build a fluent, type-safe router over a provider's discriminated event
 * union. Each `.on(type, handler)` narrows the handler's `event` to the
 * exact variant; the type parameter `THandled` accumulates so duplicate
 * registration is a compile-time error.
 *
 * @typeParam TEvent - Discriminated event union with a `type: string` discriminant.
 * @returns          - An empty {@link Router}.
 *
 * @example
 * ```ts
 * import { createRouter } from '@paysuite/webhook-toolkit/router';
 * import type { StripeEvent } from '@paysuite/webhook-toolkit/providers/stripe';
 *
 * const router = createRouter<StripeEvent>()
 *   .on('payment_intent.succeeded', async (e) => {
 *     // e.data.object is StripePaymentIntent
 *     await markPaid(e.data.object.id);
 *   })
 *   .fallback(async (e) => log.warn('unhandled', { type: e.type }));
 *
 * await router.handle(verified.event);
 * ```
 */
export function createRouter<TEvent extends { type: string }>(): Router<TEvent> {
  const handlers = new Map<string, AnyHandler>();
  let fallbackHandler: AnyHandler | null = null;

  // Single mutable router instance; the typed `.on`/`.fallback` builder
  // is purely a phantom-type illusion over this shared object.
  const router = {
    on(type: string, handler: AnyHandler) {
      handlers.set(type, handler);
      return router;
    },
    fallback(handler: AnyHandler) {
      fallbackHandler = handler;
      return router;
    },
    async handle(event: { readonly type: string }): Promise<void> {
      const h = handlers.get(event.type) ?? fallbackHandler;
      if (h) await h(event);
    },
  };

  // Cast: the exposed API uses generics for compile-time type-narrowing,
  // but the runtime object stores all handlers in a single `Map`.
  return router as unknown as Router<TEvent>;
}

/** @internal — exported for `withIdempotency` and adapter wiring tests. */
export type { RouterHandler as _Handler };
