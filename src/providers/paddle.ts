import { hex, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Paddle Billing webhook event. */
export type PaddleEvent = {
  readonly notification_id?: string;
  readonly event_type?: string;
  readonly [k: string]: unknown;
};

interface PaddleParts {
  readonly ts: number | null;
  readonly h1: ReadonlyArray<string>;
}

// Memoize on the raw header string so the same request doesn't pay the
// split twice (parseSignature + extractTimestamp both run per verify).
const parseCache = new Map<string, PaddleParts>();
const PARSE_CACHE_MAX = 256;

function parsePaddleSignature(raw: string): PaddleParts {
  const cached = parseCache.get(raw);
  if (cached) return cached;
  const parts = raw.split(';');
  let ts: number | null = null;
  const h1: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    const v = p.slice(eq + 1).trim();
    if (k === 'ts') {
      const n = Number(v);
      if (Number.isFinite(n)) ts = n;
    } else if (k === 'h1') {
      h1.push(v);
    }
  }
  const result: PaddleParts = { ts, h1 };
  if (parseCache.size >= PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(raw, result);
  return result;
}

/**
 * Paddle Billing webhook provider.
 *
 * Header: `Paddle-Signature: ts=<seconds>;h1=<hex>`. Signing string:
 * `${ts}:${rawBody}`. Algorithm: HMAC-SHA256.
 *
 * @example
 * ```ts
 * import { paddle } from '@paysuite/webhook-toolkit/providers/paddle';
 * createVerifier({ provider: paddle, secret: process.env.PADDLE_WEBHOOK_SECRET! });
 * ```
 */
export const paddle: WebhookProvider<PaddleEvent> = {
  id: 'paddle',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('paddle-signature');
    if (!raw) return null;
    const { h1 } = parsePaddleSignature(raw);
    if (h1.length === 0) return null;
    const signatures: Uint8Array[] = [];
    for (const s of h1) {
      try {
        signatures.push(hex.decode(s));
      } catch {
        // Skip malformed entries (rotation list may contain a bad value).
      }
    }
    if (signatures.length === 0) return null;
    return { signatures, raw };
  },

  extractTimestamp: (headers) => {
    const raw = headers.get('paddle-signature');
    if (!raw) return null;
    const { ts } = parsePaddleSignature(raw);
    return ts !== null ? ts * 1000 : null;
  },

  buildSigningString: ({ rawBody, timestamp }) => {
    const seconds = Math.floor((timestamp ?? 0) / 1000);
    const prefix = utf8.encode(`${String(seconds)}:`);
    const out = new Uint8Array(prefix.length + rawBody.length);
    out.set(prefix, 0);
    out.set(rawBody, prefix.length);
    return out;
  },

  parseEvent: (rawBody) => JSON.parse(utf8.decode(rawBody)) as PaddleEvent,

  idempotencyKey: (_input, event) => event.notification_id ?? null,
};
