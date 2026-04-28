import type { WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Minimal Fastify request shape used by the adapter. */
export interface FastifyLikeRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  url: string;
  method: string;
  protocol?: string;
  hostname?: string;
}

/** Minimal Fastify reply shape. */
export interface FastifyLikeReply {
  code(statusCode: number): FastifyLikeReply;
  header(name: string, value: string): FastifyLikeReply;
  send(payload?: unknown): unknown;
}

/** Minimal Fastify instance shape used by the adapter. */
export interface FastifyLikeInstance {
  addContentTypeParser(
    contentType: '*/*' | string,
    options: { parseAs: 'buffer' | 'string' },
    parser: (req: unknown, body: unknown, done: (err: Error | null, payload?: unknown) => void) => void,
  ): void;
  post(
    path: string,
    handler: (req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown,
  ): unknown;
}

/** Plugin options. */
export interface FastifyWebhookPluginOptions<P extends WebhookProvider> {
  readonly path: string;
  readonly verifier: Verifier<P>;
  readonly handler: WebhookHandler<EventOf<P>, FastifyLikeRequest>;
  readonly onError?: (err: WebhookError) => Response;
  /** HTTP status returned on success when the handler returns `void`. Default `204`. */
  readonly successStatus?: number;
}

/**
 * Register a Fastify plugin that wires a webhook route with a route-
 * scoped raw-body content-type parser. Avoids touching the global
 * Fastify content-type parser, which would interfere with non-webhook
 * JSON routes elsewhere in the app.
 *
 * @typeParam P - Provider type carried through from the verifier.
 * @param fastify - Fastify instance (any version ≥ 4).
 * @param options - Plugin options (path, verifier, handler).
 *
 * @example
 * ```ts
 * import { fastifyWebhookPlugin } from '@paysuite/webhook-toolkit/adapters/fastify';
 * fastifyWebhookPlugin(fastify, { path: '/webhooks/stripe', verifier, handler });
 * ```
 */
export function fastifyWebhookPlugin<P extends WebhookProvider>(
  fastify: FastifyLikeInstance,
  options: FastifyWebhookPluginOptions<P>,
): void {
  const onError = options.onError ?? defaultErrorResponse;
  const successStatus = options.successStatus ?? 204;

  fastify.addContentTypeParser(
    '*/*',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  fastify.post(options.path, async (req, reply) => {
    let rawBody: Uint8Array;
    const body = req.body;
    if (body instanceof Uint8Array) rawBody = body;
    else if (typeof body === 'string') rawBody = new TextEncoder().encode(body);
    else rawBody = new Uint8Array(0);

    const url = absoluteUrl(req);
    const response = await runHandler(
      options.verifier,
      options.handler,
      { headers: req.headers, rawBody, url, method: req.method },
      req,
      onError,
    );

    if (response) {
      reply.code(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(await response.text());
      return;
    }
    reply.code(successStatus).send();
  });
}

function absoluteUrl(req: FastifyLikeRequest): string {
  if (/^https?:\/\//.test(req.url)) return req.url;
  const proto = req.protocol ?? 'http';
  const host = req.hostname ?? 'localhost';
  return `${proto}://${host}${req.url}`;
}
