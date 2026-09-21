# Hosted API Worker

This is the hosted, quota-controlled path for Focus Guard. It deliberately has
no public provider key. Its provider facade supports Cloudflare AI (the default)
and TypeSafe's direct JEV API.

## One-time Cloudflare setup

```sh
wrangler d1 create focus-jev
# Copy the returned database ID into worker/wrangler.jsonc.
wrangler d1 migrations apply focus-jev --remote --config worker/wrangler.jsonc
wrangler deploy --config worker/wrangler.jsonc
```

Before production, set the production extension ID, choose conservative
free/global monthly limits, bind a custom domain after the first deploy, and
put that HTTPS URL in the extension's Hosted API URL setting. If copying this
configuration into another account, replace the two numeric Rate Limiting
namespace IDs with unused positive integers in that account.

Run locally with `npm run worker:dev`. The local D1 database is simulated;
production requests use the configured D1 binding.

## Upstream provider

Set `JEV_PROVIDER` to `cloudflare` (default) to use the AI binding and
Cloudflare's `typesafe/jev` model. `AI_GATEWAY_ID` defaults to `default`, which
Cloudflare creates on first use; set it to a named, dashboard-configured gateway
when you need dedicated gateway controls. Set `JEV_PROVIDER` to `typesafe` to call
`https://api.typesafe.ai/v1/systemone` directly, then add the API key without
placing it in source control:

```sh
wrangler secret put TYPESAFE_API_KEY --config worker/wrangler.jsonc
```

`TYPESAFE_MODEL` defaults to `jev-latest`. The provider facade has one internal
`runJev()` contract, so adding another provider requires only a new adapter that
returns the standard `{ answers, usage }` JEV-shaped result. The public API and
extension do not change.

For another System One-compatible provider, set `JEV_PROVIDER` to `compatible`,
set `COMPATIBLE_SYSTEMONE_URL` and `COMPATIBLE_MODEL`, then add
`COMPATIBLE_API_KEY` as a Worker secret. Compatibility here is deliberate: the
endpoint must accept the System One `{ model, state, questions }` contract and
return `{ answers, usage }`; arbitrary chat-completions APIs are not safe
drop-in replacements for an enforcement decision.

## Data handling

The Worker accepts only a focus statement and limited page metadata, rebuilds
the fixed JEV question server-side, and returns only answers/usage. It does not
log request bodies. Device tokens are per-installation and stored as hashes in
D1. Signed request nonces make direct replay fail; quotas are enforced both per
installation and globally so a flood of new installations cannot exceed the
configured monthly service budget.
