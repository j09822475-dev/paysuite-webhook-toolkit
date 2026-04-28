import { describe, expect, it } from 'vitest';
import { createFetchHandler } from '../adapters/fetch.js';
import { honoWebhook } from '../adapters/hono.js';
import { elysiaWebhookPlugin } from '../adapters/elysia.js';
import { nextAppWebhook } from '../adapters/next-app.js';
import { nextPagesWebhook, type NextPagesLikeRequest, type NextPagesLikeResponse } from '../adapters/next-pages.js';
import { expressWebhook, type ExpressLikeRequest, type ExpressLikeResponse } from '../adapters/express.js';
import { fastifyWebhookPlugin, type FastifyLikeReply, type FastifyLikeRequest } from '../adapters/fastify.js';
import { defaultErrorResponse, runHandler } from '../adapters/_shared/normalize.js';
import { createVerifier } from '../core/verifier.js';
import { stripe } from '../providers/stripe.js';
import { signWith } from '../testing/sign.js';
import { fakeClock } from '../testing/fake-clock.js';
import { utf8 } from '../core/encoding.js';
import { WebhookError } from '../errors/index.js';
import type { Verifier } from '../core/types.js';

const SECRET = 'whsec_test';

function makePayload(): { payload: string } {
  return {
    payload: JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', amount: 1, currency: 'usd', status: 'ok' } },
    }),
  };
}

async function signedRequest() {
  const clock = fakeClock(1_700_000_000_000);
  const ts = Math.floor(clock.now() / 1000);
  const { payload } = makePayload();
  const signed = await signWith(stripe, { secret: SECRET, payload, timestamp: ts });
  return {
    clock,
    signed,
    request: new Request('https://example.test/hooks/stripe', {
      method: 'POST',
      headers: signed.headers,
      body: signed.rawBody,
    }),
    rawBody: signed.rawBody,
    headers: signed.headers,
  };
}

describe('defaultErrorResponse', () => {
  it('should mask SIGNATURE_* codes to invalid_signature on the wire', async () => {
    const err = new WebhookError({ code: 'SIGNATURE_MISMATCH', message: 'x', httpStatus: 401, providerId: 'p' });
    const res = defaultErrorResponse(err);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_signature');
  });

  it('should preserve non-signature codes verbatim', async () => {
    const err = new WebhookError({ code: 'PAYLOAD_TOO_LARGE', message: 'x', httpStatus: 413 });
    const body = await defaultErrorResponse(err).json() as { error: string };
    expect(body.error).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('runHandler', () => {
  it('should call onError when verifier throws unexpectedly', async () => {
    const v: Verifier<typeof stripe> = {
      providerId: 'stripe',
      verify: async () => { throw new Error('boom'); },
    };
    const res = await runHandler(v, async () => undefined, { headers: {}, rawBody: new Uint8Array(0) }, undefined as never);
    expect(res?.status).toBe(500);
  });

  it('should return null when handler returns void on success', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const res = await runHandler(v, async () => undefined, { headers: signed.headers, rawBody: signed.rawBody }, null);
    expect(res).toBeNull();
  });

  it('should return Response when handler returns one', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const res = await runHandler(
      v,
      async () => new Response('ok', { status: 202 }),
      { headers: signed.headers, rawBody: signed.rawBody },
      null,
    );
    expect(res?.status).toBe(202);
  });
});

describe('createFetchHandler', () => {
  it('should return 204 when handler returns void on signed request', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = createFetchHandler(v, async () => undefined);
    const res = await handler(request);
    expect(res.status).toBe(204);
  });

  it('should forward handler-returned Response unchanged', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = createFetchHandler(v, async () => new Response('x', { status: 201 }));
    expect((await handler(request)).status).toBe(201);
  });

  it('should call onError override on failure', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const handler = createFetchHandler(v, async () => undefined, {
      onError: () => new Response('custom', { status: 418 }),
    });
    const req = new Request('https://example.test/hooks/stripe', { method: 'POST' });
    const res = await handler(req);
    expect(res.status).toBe(418);
  });

  it('should use successResponse override when provided', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = createFetchHandler(v, async () => undefined, {
      successResponse: () => new Response('done', { status: 200 }),
    });
    const res = await handler(request);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('done');
  });
});

describe('honoWebhook', () => {
  it('should run on a Hono-shaped context with c.req.raw', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = honoWebhook(v, async () => undefined);
    const res = await handler({ req: { raw: request } });
    expect(res.status).toBe(204);
  });

  it('should return error response on bad signature', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const handler = honoWebhook(v, async () => undefined);
    const req = new Request('https://example.test/hooks/stripe', { method: 'POST', body: '{}' });
    const res = await handler({ req: { raw: req } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('elysiaWebhookPlugin', () => {
  it('should register a POST route and dispatch through the verifier', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handlers = new Map<string, (ctx: { request: Request }) => Promise<Response>>();
    const fakeApp = {
      post: (path: string, h: (ctx: { request: Request }) => Promise<Response>) => { handlers.set(path, h); return fakeApp; },
    };
    const plugin = elysiaWebhookPlugin({
      path: '/hooks/stripe',
      verifier: v,
      handler: async () => undefined,
    });
    plugin(fakeApp);
    const handler = handlers.get('/hooks/stripe')!;
    const res = await handler({ request });
    expect(res.status).toBe(204);
  });
});

describe('nextAppWebhook', () => {
  it('should produce a 204 default success', async () => {
    const { clock, request } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = nextAppWebhook(v, async () => undefined);
    expect((await handler(request)).status).toBe(204);
  });

  it('should respect onError override', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const handler = nextAppWebhook(v, async () => undefined, {
      onError: () => new Response('nope', { status: 418 }),
    });
    const res = await handler(new Request('https://x/y', { method: 'POST' }));
    expect(res.status).toBe(418);
  });
});

describe('nextPagesWebhook', () => {
  function fakeRes(): NextPagesLikeResponse & { _status: number; _body: unknown; _headers: Map<string, string> } {
    let _status = 200;
    const _headers = new Map<string, string>();
    let _body: unknown = undefined;
    const r = {
      _status, _body, _headers,
      status(c: number) { (r as { _status: number })._status = c; return r; },
      setHeader(name: string, value: string) { _headers.set(name, value); },
      send(body?: string | Buffer) { (r as { _body: unknown })._body = body; },
      end() {},
    };
    return r as NextPagesLikeResponse & { _status: number; _body: unknown; _headers: Map<string, string> };
  }

  it('should accept Buffer-like body when supplied directly', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = nextPagesWebhook(v, async () => undefined);
    const req: NextPagesLikeRequest = { headers: signed.headers, body: signed.rawBody, method: 'POST', url: '/hooks/stripe' };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(204);
  });

  it('should accept string body when supplied directly', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = nextPagesWebhook(v, async () => undefined);
    const req: NextPagesLikeRequest = { headers: signed.headers, body: utf8.decode(signed.rawBody), method: 'POST', url: '/hooks/stripe' };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(204);
  });

  it('should drain a streaming body via on(data/end)', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = nextPagesWebhook(v, async () => undefined);
    type Listener = (chunk?: unknown) => void;
    const listeners = new Map<string, Listener>();
    const req: NextPagesLikeRequest = {
      headers: signed.headers,
      method: 'POST',
      url: '/hooks/stripe',
      on: (event, listener) => { listeners.set(event, listener); },
    };
    const res = fakeRes();
    const promise = handler(req, res);
    listeners.get('data')?.(signed.rawBody);
    listeners.get('end')?.();
    await promise;
    expect(res._status).toBe(204);
  });

  it('should reject body read errors with onError mapping', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const handler = nextPagesWebhook(v, async () => undefined);
    type Listener = (chunk?: unknown) => void;
    const listeners = new Map<string, Listener>();
    const req: NextPagesLikeRequest = {
      headers: {},
      method: 'POST',
      url: '/x',
      on: (event, listener) => { listeners.set(event, listener); },
    };
    const res = fakeRes();
    const promise = handler(req, res);
    listeners.get('error')?.(new Error('stream broke'));
    await promise;
    expect(res._status).toBe(500);
  });

  it('should return empty Uint8Array when neither body nor on() is present', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const handler = nextPagesWebhook(v, async () => undefined);
    const req: NextPagesLikeRequest = { headers: {}, method: 'POST', url: '/x' };
    const res = fakeRes();
    await handler(req, res);
    // Will fail SIGNATURE_MISSING with empty body; status should be 4xx.
    expect(res._status).toBeGreaterThanOrEqual(400);
  });

  it('should support successResponse override', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const handler = nextPagesWebhook(v, async () => undefined, {
      successResponse: () => new Response('ok', { status: 200 }),
    });
    const req: NextPagesLikeRequest = { headers: signed.headers, body: signed.rawBody, method: 'POST', url: '/x' };
    const res = fakeRes();
    await handler(req, res);
    expect(res._status).toBe(200);
  });
});

describe('expressWebhook', () => {
  function fakeRes(): {
    res: ExpressLikeResponse;
    done: Promise<void>;
    state: { status: number; body: unknown; headers: Map<string, string> };
  } {
    const headers = new Map<string, string>();
    const state = { status: 0, body: undefined as unknown, headers };
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const res: ExpressLikeResponse = {
      status(c: number) { state.status = c; return res; },
      setHeader(name: string, value: string) { headers.set(name, value); },
      send(body?: string | Buffer) { state.body = body; resolveDone(); },
      end() { resolveDone(); },
    };
    return { res, done, state };
  }

  it('should respond 204 when handler returns void on a Buffer body', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const middleware = expressWebhook(v, async () => undefined);
    const req: ExpressLikeRequest = {
      body: signed.rawBody,
      headers: signed.headers,
      method: 'POST',
      url: '/hooks/stripe',
      protocol: 'https',
      get: (h) => (h === 'host' ? 'example.test' : undefined),
    };
    const { res, done, state } = fakeRes();
    middleware(req, res, () => undefined);
    await done;
    expect(state.status).toBe(204);
  });

  it('should respond CONFIG-coded error when body is pre-parsed', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    const middleware = expressWebhook(v, async () => undefined);
    const req: ExpressLikeRequest = {
      body: { someJson: true } as unknown,
      headers: {},
      method: 'POST',
      url: '/x',
    };
    const { res, done, state } = fakeRes();
    middleware(req, res, () => undefined);
    await done;
    expect(state.status).toBe(500);
  });

  it('should accept string body and re-encode as bytes', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const middleware = expressWebhook(v, async () => undefined);
    const req: ExpressLikeRequest = {
      body: utf8.decode(signed.rawBody),
      headers: signed.headers,
      method: 'POST',
      url: '/hooks/stripe',
      protocol: 'https',
      get: (h) => (h === 'host' ? 'example.test' : undefined),
    };
    const { res, done, state } = fakeRes();
    middleware(req, res, () => undefined);
    await done;
    expect(state.status).toBe(204);
  });

  it('should treat absolute URLs in originalUrl as the absoluteUrl directly', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    const middleware = expressWebhook(v, async () => undefined);
    const req: ExpressLikeRequest = {
      body: signed.rawBody,
      headers: signed.headers,
      method: 'POST',
      originalUrl: 'https://full.test/hooks/stripe',
    };
    const { res, done, state } = fakeRes();
    middleware(req, res, () => undefined);
    await done;
    expect(state.status).toBe(204);
  });
});

describe('fastifyWebhookPlugin', () => {
  it('should wire a POST route that returns 204 by default', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });

    let routeHandler: undefined | ((req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown);
    const fastify = {
      addContentTypeParser: () => undefined,
      post: (_path: string, h: (req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown) => {
        routeHandler = h;
      },
    };

    fastifyWebhookPlugin(fastify, {
      path: '/hooks/stripe',
      verifier: v,
      handler: async () => undefined,
    });

    let _status = 0;
    const _headers = new Map<string, string>();
    let _body: unknown = undefined;
    const reply: FastifyLikeReply = {
      code: (c) => { _status = c; return reply; },
      header: (n, v) => { _headers.set(n, v); return reply; },
      send: (payload) => { _body = payload; return undefined; },
    };

    await routeHandler!({
      body: signed.rawBody,
      headers: signed.headers,
      url: '/hooks/stripe',
      method: 'POST',
      protocol: 'https',
      hostname: 'example.test',
    }, reply);

    expect(_status).toBe(204);
  });

  it('should treat absolute req.url as already-absolute', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    let routeHandler: undefined | ((req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown);
    const fastify = {
      addContentTypeParser: () => undefined,
      post: (_path: string, h: (req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown) => { routeHandler = h; },
    };
    fastifyWebhookPlugin(fastify, { path: '/hooks/stripe', verifier: v, handler: async () => undefined });

    let _status = 0;
    const reply: FastifyLikeReply = {
      code: (c) => { _status = c; return reply; },
      header: () => reply,
      send: () => undefined,
    };
    await routeHandler!({
      body: signed.rawBody,
      headers: signed.headers,
      url: 'https://full.test/hooks/stripe',
      method: 'POST',
    }, reply);
    expect(_status).toBe(204);
  });

  it('should handle empty body when none supplied (results in failure)', async () => {
    const v = createVerifier({ provider: stripe, secret: SECRET, clock: fakeClock(1_700_000_000_000) });
    let routeHandler: undefined | ((req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown);
    const fastify = {
      addContentTypeParser: () => undefined,
      post: (_p: string, h: (req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown) => { routeHandler = h; },
    };
    fastifyWebhookPlugin(fastify, { path: '/hooks/stripe', verifier: v, handler: async () => undefined });
    let _status = 0;
    const reply: FastifyLikeReply = {
      code: (c) => { _status = c; return reply; },
      header: () => reply,
      send: () => undefined,
    };
    await routeHandler!({
      body: undefined as unknown,
      headers: {},
      url: '/x',
      method: 'POST',
    }, reply);
    expect(_status).toBeGreaterThanOrEqual(400);
  });

  it('should accept a string body and re-encode it', async () => {
    const { clock, signed } = await signedRequest();
    const v = createVerifier({ provider: stripe, secret: SECRET, clock });
    let routeHandler: undefined | ((req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown);
    const fastify = {
      addContentTypeParser: () => undefined,
      post: (_p: string, h: (req: FastifyLikeRequest, reply: FastifyLikeReply) => unknown) => { routeHandler = h; },
    };
    fastifyWebhookPlugin(fastify, { path: '/hooks/stripe', verifier: v, handler: async () => undefined });
    let _status = 0;
    const reply: FastifyLikeReply = {
      code: (c) => { _status = c; return reply; },
      header: () => reply,
      send: () => undefined,
    };
    await routeHandler!({
      body: utf8.decode(signed.rawBody),
      headers: signed.headers,
      url: '/x',
      method: 'POST',
      protocol: 'https',
      hostname: 'example.test',
    }, reply);
    expect(_status).toBe(204);
  });
});
