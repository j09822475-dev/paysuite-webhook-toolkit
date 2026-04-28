/** Handler that receives an exact event variant of a discriminated union. */
export type RouterHandler<TEvent> = (event: TEvent) => Promise<void> | void;

/**
 * Typed router builder. The phantom `THandled` accumulates the union of
 * already-registered event types, enabling exhaustiveness checks: a
 * second `.on('payment_intent.succeeded', …)` is a compile-time error.
 */
export interface Router<TEvent extends { type: string }, THandled extends string = never> {
  /**
   * Register a handler for one event type. The handler's `event`
   * argument is narrowed to that variant.
   *
   * @typeParam TType - The event type literal being handled.
   * @param type    - Event type to match (must not have been registered yet).
   * @param handler - Handler invoked when `event.type === type`.
   * @returns       - The router with `TType` added to the handled set.
   */
  on<TType extends Exclude<TEvent['type'], THandled>>(
    type: TType,
    handler: RouterHandler<Extract<TEvent, { type: TType }>>,
  ): Router<TEvent, THandled | TType>;

  /**
   * Catch-all for any event type not yet matched by `.on(…)`. After
   * `.fallback(…)` no further `.on(…)` calls are accepted.
   *
   * @param handler - Handler invoked for any unmatched event.
   */
  fallback(
    handler: RouterHandler<Exclude<TEvent, { readonly type: THandled }>>,
  ): Router<TEvent, TEvent['type']>;

  /**
   * Dispatch a verified event through the registered handlers.
   *
   * @param event - The verified event to dispatch.
   * @returns A promise that resolves once the matching handler completes.
   */
  handle(event: TEvent): Promise<void>;
}
