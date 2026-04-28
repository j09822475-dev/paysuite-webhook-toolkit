# Basic usage — `@paysuite/webhook-toolkit`

Minimal end-to-end Stripe webhook verification: build a verifier, sign a test request with the bundled `signWith` helper, verify it, branch on the typed event.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/j09822475-dev/paysuite-webhook-toolkit/tree/main/examples/sandbox/basic-usage)

## Run locally

```bash
npm install
npm start
```

## What it shows

- `createVerifier({ provider: stripe, secret })` — one call to wire up Stripe verification.
- `signWith(stripe, …)` — build a real signed request without the Stripe SDK.
- `verifier.verify(request)` — never throws on a bad signature; returns a discriminated `VerificationResult`.
- Type-narrowed event handling via `result.event.type === 'payment_intent.succeeded'`.
- Tampered-body rejection with `SIGNATURE_MISMATCH` (HTTP 401).
