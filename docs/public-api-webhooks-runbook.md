# Watson public API and webhooks runbook

## Scope and trust boundary

The v1 API is intentionally small. It lists projects, lists tasks, creates tasks and updates a bounded set of task fields. Every API client has explicit scopes and a fixed project allowlist; adding a future project never grants access automatically. API credentials, idempotency receipts, webhook subscriptions and delivery state are server-only and are not synchronized to devices or included in user exports.

The OpenAPI document is available at `/public/v1/openapi.json`. Data endpoints require `Authorization: Bearer wtn_live_…`. Write requests also require an `Idempotency-Key` containing 8–128 letters, digits or `._:-`. Reusing the key with the same request safely replays the response; reusing it with a different request returns `409`.

## Credential lifecycle

Create and revoke keys in **Nastavení → Integrace → API a webhooky**. The full bearer token and a webhook signing secret are each shown only in the create response. Store them in a secrets manager; Watson stores only a bearer-token hash and derives the per-subscription signing secret from the isolated `PUBLIC_WEBHOOK_SIGNING_SECRET` root.

Revocation is immediate. A revoked or expired key returns `401` with `WWW-Authenticate`. Audit events record creation, revocation and public task writes without storing request bodies or credentials.

Production must supply an independent 32–512 character `PUBLIC_WEBHOOK_SIGNING_SECRET`. The production preflight rejects absence, weak values and reuse of auth, backup, local-data or metrics credentials. Root rotation changes every derived subscription secret, so pause delivery and coordinate the new secret with all receivers before resuming.

## Verifying a webhook

Watson sends these headers:

- `Watson-Event-Id`: stable delivery-deduplication ID;
- `Watson-Event-Type`: for example `task.created`;
- `Watson-Timestamp`: Unix seconds;
- `Watson-Signature`: `v1=<hex HMAC-SHA256>`.

Compute HMAC-SHA256 using the subscription signing secret over `<Watson-Timestamp>.<raw request body>`. Compare signatures in constant time, reject timestamps outside a short tolerance (recommended: five minutes), then deduplicate by event ID before processing. Do not parse and reserialize JSON before signature verification.

## Delivery behavior

Delivery is at least once. Watson accepts only 2xx as success, never follows redirects, times out after five seconds and retries with exponential backoff up to eight attempts. Exhausted deliveries move to `dead`; recent status and the safe error code are visible in Settings. Event payloads contain operational task/project fields but never task descriptions, comments, attachments, credentials or provider payloads.

The worker resolves DNS before connecting, rejects any private, loopback, link-local, documentation, multicast or reserved address, pins the selected public IP into the socket and preserves the original hostname for TLS SNI and `Host`. All resolved addresses must be public. Production subscriptions require HTTPS; local HTTP is allowed only for an exact loopback host outside production.

## Operations and recovery

- Run database migration `0082_lyrical_thanos.sql` before starting an API process with the worker.
- Monitor `webhook_worker_failed` structured log events and subscription failure counts.
- Keep receivers idempotent. Retrying a non-idempotent downstream action without event-ID deduplication is unsafe.
- Restore transactions set `watson.suppress_webhook_events=on`, so recovery does not emit false historical changes.
- Outbox events with no pending delivery are retained for 30 days and then removed by amortized worker cleanup.
- Run `pnpm --filter @watson/api verify:public-api` against the integration stack after changes to auth, tasks, projects, DNS, TLS or migrations.
