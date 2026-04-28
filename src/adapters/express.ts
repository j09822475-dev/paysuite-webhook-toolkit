import { configError, WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Options for `expressWebhook`. */
export interface ExpressWebhookOptions {
  /** Override default error → Response mapping. */
  readonly onError?: (err: WebhookError) => Response;
  /** Override default success Response (when the handler returns `void`). Default 204 / empty body. */
  readonly successResponse?: () => Response;
}

/**
 * Minimal Express request shape used by the adapter. Avoids depending
 * on `@types/express` in the published types.
 */
export interface ExpressLikeRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  originalUrl?: string;
  method?: string;
  protocol?: string;
  get?(header: string): string | undefined;
}

/** Minimal Express response shape used by the adapter. */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  setHeader(name: string, value: string): void;
  send(body?: string | Buffer): void;
  end(): void;
}

/** Minimal Express next-function shape. */
export type ExpressNext = (err?: unknown) => void;

/** Minimal Express handler signature. */
export type ExpressHandler = (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressNext) => void;

/**
 * Build an Express webhook handler. **Requires `express.raw()` to be
 * mounted before this handler** so `req.body` is a `Buffer` of the raw
 * bytes — pre-parsed JSON destroys the byte sequence and breaks
 * signature verification.
 *
 * @typeParam P - Provider type carried through from `verifier`.
 * @param verifier - The verifier.
 * @param handler  - Webhook handler.
 * @param options  - Override knobs.
 *
 * @returns An Express `(req, res, next) => void` middleware.
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { expressWebhook } from '@paysuite/webhook-toolkit/adapters/express';
 *
 * app.post(
 *   '/webhooks/stripe',
 *   express.raw({ type: 'application/json' }),
 *   expressWebhook(verifier, async (event) => { ... }),
 * );
 * ```
 */
export function expressWebhook<P extends WebhookProvider>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, ExpressLikeRequest>,
  options: ExpressWebhookOptions = {},
): ExpressHandler {
  const onError = options.onError ?? defaultErrorResponse;
  const successResponse = options.successResponse ?? (() => new Response(null, { status: 204 }));

  return (req, res, next) => {
    void (async (): Promise<void> => {
      const body = req.body;
      let rawBody: Uint8Array;
      if (body instanceof Uint8Array) {
        rawBody = body;
      } else if (typeof body === 'string') {
        rawBody = new TextEncoder().encode(body);
      } else {
        const err = configError(
          "Express webhook handler received a parsed body. Mount `express.raw({ type: 'application/json' })` before this route.",
          verifier.providerId,
        );
        sendErrorResponse(res, onError(err));
        return;
      }

      const url = absoluteUrl(req);
      const method = req.method ?? 'POST';
      const response = await runHandler(
        verifier,
        handler,
        { headers: req.headers, rawBody, url, method },
        req,
        onError,
      );
      await sendResponse(res, response ?? successResponse());
    })().catch(next);
  };
}

function absoluteUrl(req: ExpressLikeRequest): string {
  const path = req.originalUrl ?? req.url ?? '/';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const proto = req.protocol ?? 'http';
  const host = req.get?.('host') ?? 'localhost';
  return `${proto}://${host}${path}`;
}

async function sendResponse(res: ExpressLikeResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.send(text);
}

function sendErrorResponse(res: ExpressLikeResponse, response: Response): void {
  void sendResponse(res, response);
}
