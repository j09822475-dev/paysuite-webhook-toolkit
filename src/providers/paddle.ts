import { hex, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Paddle Billing webhook event. */
export type PaddleEvent = {
  readonly notification_id?: string;
  readonly event_type?: string;
  readonly [k: string]: unknown;
};

function parsePaddleSignature(raw: string): { ts: number | null; h1: string[] } {
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
  return { ts, h1 };
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
    return { signatures: h1.map((s) => hex.decode(s)), raw };
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
