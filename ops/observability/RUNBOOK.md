# Watson SLO monitoring runbook

`GET /ops/slo` is the server-to-server source for the first production SLO dashboard. It contains no user content or identifiers. It is deliberately separate from the product UI and from public liveness/readiness probes.

## Access and polling

- Supply an independent random `OPS_METRICS_TOKEN` of 32–512 characters through the secrets manager. It must not equal the Better Auth, backup, PowerSync, LuckyOS, or local-data key.
- Poll every 30 seconds with `Authorization: Bearer <token>`. Never put the token in a URL, browser bundle, dashboard annotation, or log.
- Missing/short tokens make production startup fail closed. Missing or invalid request credentials return 503/401 and `Cache-Control: no-store`.
- Poll every API replica. Counters are process-local and reset on restart; the monitoring system must calculate deltas per `processStartedAt` and then sum rates across replicas. `reminderDead` and `database` are authoritative database-backed gauges.

## Required panels and initial alerts

| Signal | Panel | Initial alert |
|---|---|---|
| `database`, `/health/ready` | readiness by replica | down for 2 minutes |
| `http5xxTotal / apiRequestsTotal` delta | API 5xx rate and count | >2% for 5 minutes with at least 20 requests |
| `authFailureTotal` delta | failed auth/rate-limit attempts | >20 in 5 minutes or 3× the 7-day baseline |
| `syncRejectionTotal` delta | permanent 400/403/409/422 sync rejects | >5% of sync writes for 10 minutes or sudden 3× increase |
| `providerTimeoutTotal` delta | upstream 504 timeouts | 3 in 10 minutes for any replica |
| `reminderDead` | undeliverable reminders | >0 for 5 minutes |

The first thresholds are conservative pilot defaults, not universal truth. Change them only from observed traffic and record the reason. A 401/408/429 sync response is retryable and is intentionally not counted as a permanent sync rejection. LuckyOS read-only identity/status routes are fail-soft; provider health becomes a separate F4 registry signal rather than a fabricated HTTP failure.

## Triage

1. Correlate the dashboard interval with structured `http_request` logs by `requestId`; logs never include query strings or authorization headers.
2. For 5xx, separate database failure, application failure, and upstream 502/504. Preserve the first safe error signature and deployment version.
3. For sync rejection, inspect error-code distribution and the recovery inbox before retrying. Never delete a client outbox to make the graph green.
4. For dead reminders, keep `sent_at` null, inspect `last_error_code`, restore the provider, and requeue through an audited command/runbook.
5. For provider timeouts, stop automatic retries when the provider budget or rate limit is at risk. AI remains default-deny and human-reviewed.
6. Declare an incident when the readiness or 5xx error-budget alert fires. Use the deployment rollback and PostgreSQL restore runbooks; do not restore over the only production database.

## Token rotation

Create a new independent token in the secrets manager, update every scraper, deploy the API with the new token, verify one successful authorized poll and one rejected old-token poll, then revoke the old secret. The endpoint intentionally has no overlap token; rotate during a monitored window and expect at most one missed scrape.
