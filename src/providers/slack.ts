import { hex, utf8 } from '../core/encoding.js';
import type { WebhookProvider } from '../core/types.js';

/** Slack event-callback / interactive payload. Loose JSON shape. */
export type SlackEvent = {
  readonly event_id?: string;
  readonly type?: string;
  readonly [k: string]: unknown;
};

/**
 * Slack webhook provider.
 *
 * Header: `X-Slack-Signature: v0=<hex>`. Signing string is
 * `v0:${X-Slack-Request-Timestamp}:${rawBody}`.
 *
 * @example
 * ```ts
 * import { slack } from '@paysuite/webhook-toolkit/providers/slack';
 * createVerifier({ provider: slack, secret: process.env.SLACK_SIGNING_SECRET! });
 * ```
 */
export const slack: WebhookProvider<SlackEvent> = {
  id: 'slack',
  algorithm: 'HMAC-SHA256',

  parseSignature: (headers) => {
    const raw = headers.get('x-slack-signature');
    if (!raw) return null;
    const value = raw.startsWith('v0=') ? raw.slice('v0='.length) : raw;
    return { signatures: [hex.decode(value)], raw };
  },

  extractTimestamp: (headers) => {
    const v = headers.get('x-slack-request-timestamp');
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n * 1000 : null;
  },

  buildSigningString: ({ rawBody, timestamp }) => {
    const seconds = Math.floor((timestamp ?? 0) / 1000);
    const prefix = utf8.encode(`v0:${String(seconds)}:`);
    const out = new Uint8Array(prefix.length + rawBody.length);
    out.set(prefix, 0);
    out.set(rawBody, prefix.length);
    return out;
  },

  parseEvent: (rawBody) => {
    const text = utf8.decode(rawBody);
    if (text.trimStart().startsWith('{')) return JSON.parse(text) as SlackEvent;
    // application/x-www-form-urlencoded (e.g. interactive `payload=…`).
    const params: Record<string, string> = {};
    for (const part of text.split('&')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      params[decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '))] = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    }
    if (params['payload']) return JSON.parse(params['payload']) as SlackEvent;
    return params as SlackEvent;
  },

  idempotencyKey: (_input, event) => event.event_id ?? null,
};
