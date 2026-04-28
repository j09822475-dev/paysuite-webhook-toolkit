# Code-Review Response — PR #1

Responses to Vasyl Bruhanda's review (REQUEST_CHANGES). Items are
numbered in the order they appear in the review. Tests are deliberately
out of scope for this round — they are the next phase.

---

## Major

### 1. Multi-verifier DoS hole — `maxBodyBytes` not enforced before child runs

**Concern:** `multi-verifier.ts:156-166`'s `normalize()` called
`new Uint8Array(await cloned.arrayBuffer())` with no size cap, so a
500 MiB body would be fully resident before the child verifier's own
`maxBodyBytes` check fired. `MultiVerifierOptions` had no such option.

**Resolution:** Agreed. Added `maxBodyBytes?: number` to
`MultiVerifierOptions` (default `1_048_576`). Reworked `normalize()`
to read `Request#body` via `core/body.ts#readRawBody` so the cap is
enforced as bytes arrive (the same streaming guard the per-provider
verifier uses). `Request`s without a body fall through to a buffered
read with a post-hoc length check via a new `enforceCap` helper. Plain-
object inputs likewise route through `readRawBody(input, maxBodyBytes)`
instead of `Number.POSITIVE_INFINITY`.

**Files changed:** `src/core/multi-verifier.ts`.

### 2. Stripe rotation regression on a single malformed `v1` entry

**Concern:** `parts.v1.map((s) => hex.decode(s))` throws on the first
malformed `v1=` entry, which the verifier maps to `SIGNATURE_MALFORMED`
for the whole request. Plan §9.2 item 8 explicitly says "try every
`v1` and accept if any match". The svix-style parser already does
the right thing.

**Resolution:** Agreed. Replaced the `.map(hex.decode)` with a
`for…try { sigs.push(hex.decode(s)) } catch {}` loop that skips
malformed entries and only returns `null` if zero usable signatures
remain. Mirrors the pattern in `_shared/svix-style.ts:30-33`.

**Files changed:** `src/providers/stripe.ts`.

### 3. Paddle rotation regression — same shape as #2

**Concern:** `h1.map((s) => hex.decode(s))` throws on the first
malformed `h1=` entry.

**Resolution:** Agreed. Same fix applied — skip malformed entries.

**Files changed:** `src/providers/paddle.ts`.

### 4. Dead `VerifierOptions.url` field

**Concern:** `core/types.ts:248-254` declared `url?: string` on
`VerifierOptions` and JSDoc'd it, but `createVerifier` never reads it
(`verifier.ts:68-77`). Misleading public surface.

**Resolution:** Agreed — deleted (preferred option). Adapters already
set `NormalizedRequest.url`, so there's no remaining need for it.

**Files changed:** `src/core/types.ts`.

---

## Medium

### 5. Mailgun JSON-parses the body 3× per request

**Concern:** `parseMailgunSig(rawBody)` ran `JSON.parse(utf8.decode(...))`
in `extractTimestamp`, `verify`, AND `parseEvent`.

**Resolution:** Agreed. Introduced a module-scoped
`WeakMap<Uint8Array, MailgunParse>` cache keyed on the raw body buffer
(the same `Uint8Array` flows through the verifier unchanged). The
parse — including the parsed JSON body and the validated `signature`
sub-object — is shared across `extractTimestamp`, `verify`, and
`parseEvent`. WeakMap is the right structure here: entries are GC'd
once the request's `rawBody` goes out of scope, so there's no
accumulation across requests.

**Files changed:** `src/providers/mailgun.ts`.

### 6. Discord/SendGrid re-import the Ed25519 `CryptoKey` on every request

**Concern:** `subtle.importKey('raw', …, 'Ed25519', …)` is the expensive
part of Ed25519 verification, and it ran on every call. With a
two-secret rotation list that's 2 imports per request.

**Resolution:** Agreed. Added a `WeakMap<Uint8Array, Promise<CryptoKey>>`
cache in `core/crypto.ts` keyed on the raw 32-byte public key, so the
imported `CryptoKey` is reused across requests. Wrapped the import in
`importEd25519Key()` and made `verifyEd25519` consume the cache. The
unsupported-runtime error path deletes the failed entry so a transient
failure doesn't poison the cache.

To get cache hits even when the user passes a hex/base64/PEM secret
(in which case `normalizeEd25519PublicKey` allocates a new buffer each
call), Discord and SendGrid each maintain a small
`WeakMap<Uint8Array, Uint8Array>` cache that memoizes the
normalization step on the input secret bytes — the same `secret`
buffer flows through the verifier, so this gives a stable identity to
the `publicKey` used as the outer cache key.

**Files changed:** `src/core/crypto.ts`, `src/providers/discord.ts`,
`src/providers/sendgrid.ts`.

### 7. Memory store eviction is FIFO, not "drop expired first"

**Concern:** Under bursty load with mixed TTLs, the oldest-inserted
entry may still be valid while many short-TTL entries have already
expired.

**Resolution:** Agreed. Added an `evictOne(map, now)` helper that
walks at most 32 entries; the first expired one it finds is evicted,
otherwise it falls back to oldest-by-insertion. Bounded scan keeps
eviction effectively O(1) under the cap while avoiding the
pathological case the reviewer described.

**Files changed:** `src/idempotency/memory.ts`.

### 8. `WebhookProvider<any>` constraints

**Concern:** `EventOf<P extends WebhookProvider<any>>`, `Verifier<P
extends WebhookProvider<any>>`, `VerifierOptions<P extends
WebhookProvider<any>>`, and the `Record<string,
Verifier<WebhookProvider>>` constraint in `multi-verifier.ts:15` use
`any` in the constraint position, which disables variance checking.

**Resolution:** Partially agreed — and reverted to `<any>` after
investigation. The change to `<unknown>` is theoretically nicer but
breaks at the bound check: `WebhookProvider`'s `idempotencyKey?:
(input, event: TEvent) => string | null` field makes the type
**contravariant in `TEvent`** under `strictFunctionTypes`. As a
result, `WebhookProvider<StripeEvent>` is **not** assignable to
`WebhookProvider<unknown>`, so `createVerifier({ provider: stripe })`
fails the constraint check. The same trap applies to
`WebhookProvider<MultiVerifierEvent>` for `createMultiVerifier`'s
return type (typecheck reproduces this — TS2344).

The structural alternatives all have downsides:
- Switching `idempotencyKey` to method shorthand `idempotencyKey?(input,
  event: TEvent): string | null` would make the parameter bivariant and
  fix the constraint, but bivariance is its own footgun and changes the
  user-facing interface declaration.
- Using `unknown` plus an internal cast hides the variance issue at the
  one call site that matters but doesn't change the public type, so the
  reviewer's concern about consumer variance ("if a user widens to a
  typed variable, event types collapse to `unknown`") would still apply.

I added a JSDoc comment on `EventOf` explaining why `<any>` is the
correct escape hatch here (the reviewer themselves acknowledged the
caveat, calling it "a `medium`"). Net effect on consumers: identical
inference, with the contract documented.

**Files changed:** `src/core/types.ts` (added comment;
constraint kept as `<any>`).

### 9. Idempotency telemetry tags `'multi'` instead of the child providerId

**Concern:** `metrics.increment(..., { providerId: verifier.providerId })`
in `idempotency/index.ts:80,93` always tags `'multi'` when the verifier
is a multi-verifier. The actual idempotency key is `${childId}:${rawKey}`,
so the per-vendor info is right there but discarded.

**Resolution:** Agreed. Added `extractChildProviderId(idempotencyKey,
fallback)` that splits on the first `:`. The core verifier already
prefixes keys with `${provider.id}:`, so for a plain verifier the
extracted prefix equals `verifier.providerId` (no behavior change), and
for a multi-verifier it's the child id. Wired into both the
`idempotency.duplicate` and `idempotency.store_error` increments.

`WebhookError.providerId` on the returned error is intentionally left
as the wrapping verifier's id (`'multi'`) — that's the interface the
adapter sees and matches the existing semantics.

**Files changed:** `src/idempotency/index.ts`.

---

## Minor

### 10. `stripe-style` / `paddle` parsed twice per request

**Concern:** `stripeStyleSignature.parse(raw)` runs once in
`parseSignature` and once in `extractTimestamp`. Tiny, but trivially
fixed.

**Resolution:** Agreed. Added a small bounded LRU
(`parseCache: Map<string, Parts>`, cap 256) keyed on the raw header
string in `_shared/stripe-style.ts` and `providers/paddle.ts`. Parse
is now memoized within and across requests for the same header
bytes — the keyset is bounded by the cap and entries are short
strings, so memory cost is negligible.

**Files changed:** `src/providers/_shared/stripe-style.ts`,
`src/providers/paddle.ts`.

### 11. `core/result.ts` is dead code

**Concern:** `Ok` / `Err` / `Result` are exported but nothing
imports them; the verifier returns inline object literals.

**Resolution:** Agreed — deleted (preferred option). The `<2 KB root`
budget treats every byte as accounted-for, so dead exports are wasted
budget. `VerificationResult` in `core/types.ts` is the actual public
result type.

**Files changed:** Deleted `src/core/result.ts`.

### 12. Unused `RouterHandler as _Handler` re-export

**Concern:** `router/index.ts:58` `export type { RouterHandler as _Handler };`
is unused.

**Resolution:** Agreed. Removed the line and the now-unused
`RouterHandler` import alias. `RouterHandler` is still exported via the
top-level `export type { Router, RouterHandler }` re-export.

**Files changed:** `src/router/index.ts`.

### 13. `void fromRecord; // placeholder reference` in testing/sign.ts

**Concern:** Code smell — if `fromRecord` is unneeded, remove the
import and the `void` line.

**Resolution:** Agreed in spirit, but `fromRecord` IS used —
it's invoked in the generic-provider fallback branch of `signWith`'s
`switch` statement (the `default:` case calls `fromRecord({})` to
build a `HeaderBag` for the provider's `buildSigningString`). The
`void fromRecord;` was left over from earlier scaffolding when only
the named-provider cases existed. Removed the placeholder line; the
import is still needed for the actual `fromRecord({})` call below.

**Files changed:** `src/testing/sign.ts`.

### 14. Top-level `setInterval` in `memoryStore`

**Concern:** Top-level interval start fires at module load — Cloudflare
Workers may warn or no-op, and the `unref` branch is Node-only.

**Resolution:** Agreed. Moved the interval start into the first
`putIfAbsent` call (lazy). Workers that import `memoryStore` but
never receive a request now never trigger the interval.
`sweepIntervalMs: 0` still disables sweeping; the lazy guard runs
once per store regardless.

**Files changed:** `src/idempotency/memory.ts`.

### 15. Adapter API inconsistency: `successResponse` vs `successStatus`

**Concern:** `fetch.ts`/`hono.ts`/`elysia.ts`/`next-app.ts` accept
`successResponse: () => Response` while `express.ts`/`fastify.ts`/
`next-pages.ts` accept `successStatus: number`.

**Resolution:** Agreed — unified on `successResponse` everywhere.
Updated the three Node-side adapters to accept
`successResponse?: () => Response` and forward `status`/`headers`/
`body` exactly as they already do for error responses. This is the
strictly-more-expressive of the two: a user who only wants to set a
status code can `() => new Response(null, { status: 200 })`. Matches
how the same adapters already shape error responses. Behavior of
the old `successStatus: 204` default is preserved as the default
factory.

**Files changed:** `src/adapters/express.ts`, `src/adapters/fastify.ts`,
`src/adapters/next-pages.ts`.

---

## What's good — kept as-is

The reviewer's praise for the strategy decomposition, the
canonical `timingSafeEqual` with the long-form length-pre-check
comment, symmetric replay enforcement (`Math.abs`), wire-error
masking, default `'skip'` idempotency mode, the malformed-entry
skip in `_shared/svix-style.ts`, the streaming `readRawBody` cap,
the `MultiVerifierEvent` discriminated union, tree-shake hygiene,
header normalization, and the Postmark/Mailgun escape hatches
were left unchanged.

---

## Verification

- `npm run typecheck` — passes after all changes.
- `npm run build` — produces all `dist/*.js` and `dist/*.d.ts`
  artifacts; ESM build succeeds in ~500 ms.
- Tests intentionally untouched this round — they are the next phase.
