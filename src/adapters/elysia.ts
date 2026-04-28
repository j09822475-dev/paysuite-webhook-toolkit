import type { WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Minimal Elysia context shape exposing the Web `Request`. */
export interface ElysiaLikeContext {
  request: Request;
}

/** Minimal Elysia plugin handle. */
export interface ElysiaLikeApp {
  post(
    path: string,
    handler: (ctx: ElysiaLikeContext) => Promise<Response> | Response,
  ): unknown;
}

/** Options for the Elysia plugin. */
export interface ElysiaWebhookPluginOptions<P extends WebhookProvider> {
  readonly path: string;
  readonly verifier: Verifier<P>;
  readonly handler: WebhookHandler<EventOf<P>, ElysiaLikeContext>;
  readonly onError?: (err: WebhookError) => Response;
  readonly successResponse?: () => Response;
}

/**
 * Elysia plugin factory — returns an `(app) => app` shape.
 *
 * @typeParam P - Provider type carried through.
 * @param options - Plugin options.
 * @returns A function `(app) => app` to pass to `new Elysia().use(...)`.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia';
 * import { elysiaWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/elysia';
 * new Elysia().use(elysiaWebhookPlugin({
 *   path: '/webhooks/stripe',
 *   verifier,
 *   handler: async (event) => { ... },
 * }));
 * ```
 */
export function elysiaWebhookPlugin<P extends WebhookProvider>(
  options: ElysiaWebhookPluginOptions<P>,
): <TApp extends ElysiaLikeApp>(app: TApp) => TApp {
  const onError = options.onError ?? defaultErrorResponse;
  const successResponse = options.successResponse ?? (() => new Response(null, { status: 204 }));

  return ((app) => {
    app.post(options.path, async (ctx) => {
      const response = await runHandler(options.verifier, options.handler, ctx.request, ctx, onError);
      return response ?? successResponse();
    });
    return app;
  }) as <TApp extends ElysiaLikeApp>(app: TApp) => TApp;
}
