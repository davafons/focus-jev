# JEV Focus infrastructure plan

This document describes the recommended hosted architecture for the Focus Guard
extension, with JEV access brokered by our own Cloudflare service.

## Naming

The repository is now `focus-jev`. Keep **Focus Guard** as the extension name
for the first public release: it describes the user benefit, while JEV is the
decision engine. Candidate future product names are **JEV Focus** and
**Offtrack**; do not rename the store listing until a name and domain are
settled.

## Security boundary

The extension is an untrusted public client. There is no reliable way to prove
that an arbitrary Internet request came only from a browser extension. CORS,
the extension origin, a User-Agent, and a key bundled in the extension are all
signals that can be copied or spoofed.

The goal is therefore:

- never ship a JEV/provider API key in the extension;
- make every installation independently revocable and rate-limitable;
- make replay and bulk scraping expensive;
- enforce usage limits on the server; and
- minimize the page data retained by the service.

## Two privacy modes

We should make the choice explicit in onboarding rather than implying that a
hosted free tier is private in the same way as direct use.

### Direct / BYOK mode (highest privacy)

The extension calls the user's selected provider directly. The user's TypeSafe
JEV API key is used only by the extension, and our backend is not in the data
path. The existing Cloudflare-account mode can remain as a second BYOK adapter
for users who already have that setup.

The settings model should become provider-based:

- `hosted` — our free/paid service;
- `typesafe` — direct TypeSafe API key, using `POST https://api.typesafe.ai/v1/systemone`;
- `cloudflare` — direct Cloudflare account ID/token;
- `compatible` — a user-selected System One-compatible endpoint that accepts the typed JEV contract.

The extension should show a clear “direct to provider” label for BYOK modes.
Keys are still secrets from the user's perspective: extension packages can be
inspected and browser-profile storage is not a hardware security module. We
should therefore document least-privilege keys, never log them, provide a
delete/reset action, and avoid sending them anywhere except the selected
provider.

TypeSafe's published OpenAPI contract uses `Authorization: Bearer <API_KEY>`
with `POST /v1/systemone`; the extension's TypeSafe adapter uses that direct
path. A compatible endpoint must use the same request/response shape rather
than merely accepting a generic chat-completions request.

### Hosted mode (convenient free tier)

The extension sends the decision input to our gateway, which authenticates the
installation and forwards it to JEV. We must say plainly that the gateway can
technically see the request while it is processing it, even if we configure it
not to retain it. The privacy promise should be “no human access and no
retention by default,” not “we cannot see it.”

For this mode, use a no-content-logging Worker, strict redaction, short-lived
operational logs, a published retention policy, and an independently reviewed
request schema. Consider a user-controlled local redaction step before either
mode (for example, stripping query strings and reducing metadata to the fields
needed for the decision).

Application-layer encryption does not solve this by itself. If our Worker must
decrypt the request before sending it to JEV, we can decrypt it. A blind relay
is only possible if TypeSafe provides an end-to-end encryption/envelope
protocol that lets its API decrypt the payload; ordinary HTTPS to our Worker
does not provide that property.

## Recommended first production shape

```text
Focus Guard extension
        |
        | HTTPS, signed request, short-lived device token
        v
Public gateway Worker: api.focus-jev.<domain>
        |-- D1: installations, accounts, plans, usage ledger
        |-- Rate Limiting binding: burst/abuse control
        |-- Analytics Engine/Workers Logs: aggregate operational events
        |
        | Service binding (not public HTTP)
        v
Private inference Worker
        |
        | JEV/AI binding or encrypted Worker secret
        v
JEV provider
```

For an initial beta, the gateway and inference handler may live in one Worker.
Keep the inference boundary as a module so it can become a private service
binding without changing the extension protocol.

## Client enrolment and request authentication

On first run, the extension registers a random per-installation device token.
The Worker stores only its SHA-256 hash. The token is used as the HMAC key for
the signed request protocol described below. A later migration can replace this
with a non-exportable Web Crypto signing key, but the extension must not claim
that browser storage makes either credential unextractable.

The gateway returns a revocable device credential. Each decision request
contains the device ID, timestamp, nonce, request hash, and HMAC signature over
those fields. The gateway verifies the signature, rejects stale timestamps and
replayed nonces, checks the device status and plan, then forwards only an
allowlisted request shape to JEV.

This does not make the extension impossible to automate: a malicious user can
still drive their own installed extension. It does prevent a leaked provider
secret from becoming a universal service credential and gives us a practical
unit for revocation, quotas, and abuse detection.

`Origin: chrome-extension://<published-extension-id>` should be checked for
browser ergonomics and CORS, but never treated as authentication.

## Suggested API

- `POST /v1/install` — register a device token.
- `POST /v1/decision` — accept the typed JEV input and return the typed result.
- `GET /v1/status` — return plan, remaining allowance, and service version.
- `GET /health` — non-sensitive liveness check.

The decision endpoint rejects oversized payloads and malformed requests, never
forwards unknown fields, binary content, cookies, headers copied from pages, or
full page bodies, and normalizes/truncates URLs, titles, and metadata before
forwarding them. Do not log focus statements or page URLs by default.

## Plans and quota accounting

Start with a server-configured free plan and one paid plan. Example starting
values (product knobs, not security assumptions):

- free: a small monthly decision allowance per account/device;
- paid: a substantially larger allowance with a hard monthly cap;
- all plans: a short burst limit and a maximum request size.

Use the Cloudflare Rate Limiting binding for fast abuse protection. Do not use
it as the billing ledger because its counters are intentionally eventually
consistent. Record authoritative monthly usage in D1, with an idempotency key
per decision request. If concurrent quota spending becomes significant, put
the account/device counter behind a Durable Object or an equivalent serialized
operation.

For the first release, an activation code is simpler than a full account
system. The code is redeemed once by the extension, the server stores only a
hash of it, and the resulting account can have multiple revocable devices.
Add email/OAuth and a payment provider only when paid conversion justifies the
additional personal-data and support surface.

## Secrets and Cloudflare resources

- Store upstream JEV credentials as Worker secrets or use a native AI binding;
  never put them in `manifest.json`, source, extension storage, or a public
  environment variable.
- Use D1 for installations, account/plan state, revocations, and usage.
- Use a Durable Object only when strict per-account serialization is needed;
  do not introduce it just for ordinary configuration.
- Use a service binding for a private inference Worker if gateway and model
  execution need separate deployments.
- Enable structured observability, but redact request bodies and identifiers
  that are not needed for abuse analysis.
- Maintain separate staging and production Workers, databases, secrets, and
  extension IDs.

## Privacy defaults

The gateway should be stateless with respect to browsing content unless a user
explicitly opts into diagnostics. Store aggregate counts and error classes,
not raw focus statements, URLs, titles, or JEV prompts. Give users a clear
data-flow disclosure in the extension and publish the privacy policy before
store submission.

## Rollout

1. Extract the current direct Cloudflare call behind a provider adapter
   interface, and add a direct TypeSafe API-key adapter once its API contract is
   confirmed.
2. Make direct/BYOK mode the privacy-first default for technical users; keep
   hosted mode opt-in and label its data path clearly.
3. Build a staging gateway with an upstream secret and no paid plan.
4. Add installation keys, nonce/replay checks, payload limits, and D1-backed
   quotas.
5. Switch hosted-mode requests to gateway enrolment; do not remove BYOK
   settings or the direct provider path.
6. Add logs/metrics with redaction and run abuse tests (replay, copied token,
   burst traffic, oversized payloads, and quota races).
7. Launch a small hosted free beta, watch upstream spend and error rates, then add
   activation/payment flows.

## Explicit non-goals

- Do not distribute one shared JEV/NPA/provider key to all users.
- Do not rely on a secret embedded in JavaScript; extensions can be inspected.
- Do not expose the inference Worker publicly if a service binding is enough.
- Do not promise that the backend accepts requests exclusively from the
  extension; promise controlled access, quotas, revocation, and privacy.
