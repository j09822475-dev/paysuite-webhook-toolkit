import { configError, type WebhookError } from '../errors/index.js';
import type { EventOf, Verifier, WebhookHandler, WebhookProvider } from '../core/types.js';
import { defaultErrorResponse, runHandler } from './_shared/normalize.js';

/** Minimal Next.js Pages-router request shape. */
export interface NextPagesLikeRequest {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  method?: string;
  on?(event: 'data' | 'end' | 'error', listener: (chunk?: unknown) => void): void;
}

/** Minimal Next.js Pages-router response shape. */
export interface NextPagesLikeResponse {
  status(code: number): NextPagesLikeResponse;
  setHeader(name: string, value: string): void;
  send(body?: string | Buffer): void;
  end(): void;
}

/** Options for `nextPagesWebhook`. */
export interface NextPagesWebhookOptions {
  readonly onError?: (err: WebhookError) => Response;
  /** HTTP status returned on success when the handler returns `void`. Default `204`. */
  readonly successStatus?: number;
}

/**
 * Build a Next.js Pages-Router API route handler. The route file MUST
 * disable Next's body parser:
 *
 * ```ts
 * export const config = { api: { bodyParser: false } };
 * ```
 *
 * Otherwise Next will pre-parse the JSON, destroying the byte sequence
 * required for signature verification.
 *
 * @typeParam P - Provider type carried through.
 * @param verifier - The verifier.
 * @param handler  - Webhook handler.
 * @param options  - Override knobs.
 *
 * @returns `(req, res) => Promise<void>` route handler.
 *
 * @example
 * ```ts
 * import { nextPagesWebhook } from '@paysuite/webhook-toolkit/adapters/next-pages';
 * export const config = { api: { bodyParser: false } };
 * export default nextPagesWebhook(verifier, async (event) => { ... });
 * ```
 */
export function nextPagesWebhook<P extends WebhookProvider>(
  verifier: Verifier<P>,
  handler: WebhookHandler<EventOf<P>, NextPagesLikeRequest>,
  options: NextPagesWebhookOptions = {},
): (req: NextPagesLikeRequest, res: NextPagesLikeResponse) => Promise<void> {
  const onError = options.onError ?? defaultErrorResponse;
  const successStatus = options.successStatus ?? 204;

  return async (req, res) => {
    let rawBody: Uint8Array;
    try {
      rawBody = await readPagesBody(req);
    } catch (cause) {
      const err = cause instanceof Error
        ? configError(`Failed to read request body: ${cause.message}`, verifier.providerId)
        : configError('Failed to read request body', verifier.providerId);
      await sendResponse(res, onError(err));
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'POST';
    const response = await runHandler(
      verifier,
      handler,
      { headers: req.headers, rawBody, url, method },
      req,
      onError,
    );

    if (response) {
      await sendResponse(res, response);
    } else {
      res.status(successStatus).end();
    }
  };
}

async function readPagesBody(req: NextPagesLikeRequest): Promise<Uint8Array> {
  if (req.body instanceof Uint8Array) return req.body;
  if (typeof req.body === 'string') return new TextEncoder().encode(req.body);
  // Stream-mode (`api: { bodyParser: false }`).
  if (typeof req.on !== 'function') return new Uint8Array(0);
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on?.('data', (chunk: unknown) => {
      if (chunk instanceof Uint8Array) chunks.push(chunk);
      else if (typeof chunk === 'string') chunks.push(new TextEncoder().encode(chunk));
    });
    req.on?.('end', () => {
      let total = 0;
      for (const c of chunks) total += c.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        out.set(c, off);
        off += c.length;
      }
      resolve(out);
    });
    req.on?.('error', (e: unknown) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

async function sendResponse(res: NextPagesLikeResponse, response: Response): Promise<void> {
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await response.text();
  res.send(text);
}
