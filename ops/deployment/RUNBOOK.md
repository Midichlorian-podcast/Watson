# Watson production configuration and secret rotation

This runbook turns repository-level security guarantees into a repeatable release procedure. It does not prove that a cloud deployment, TLS certificate, alert route, retained CI artifact, or PostgreSQL PITR policy actually exists; those remain platform evidence that an operator must attach to the release.

## Release preflight

1. Inject production values from the secrets manager. Never keep a completed environment file in Git, CI artifacts, shell history, or a support ticket. `production.env.example` is a list of variable names only; its reserved `.example` hosts and `<secret-manager:…>` references deliberately fail the preflight.
2. Run `pnpm verify:production-config` in the same container and with the same injected environment that will start the API. The command fails closed and writes a sanitized `artifacts/production-preflight.json` with mode `0600`.
3. Read every warning. A warning means an optional provider is intentionally disabled, not that it was silently accepted. Record the release decision for Google OAuth, Anthropic, and LuckyOS.
4. Start the API and require both `/health/ready` and one authorized `/ops/slo` poll to succeed. Confirm that an invalid metrics token is rejected and that public signup remains closed.
5. Run database integration, release E2E, dependency audit, backup/restore, and runtime accessibility gates against the release candidate. Retain only sanitized reports.
6. Deploy one replica/canary, inspect SLO deltas and structured logs, then continue the rollout. Roll back on readiness, migration, authentication, or permanent-sync-rejection regression.

The preflight validates structure, policy, HTTPS boundaries, and secret isolation. The API's signing-key loader performs the cryptographic import at startup; the preflight deliberately never exports, logs, or hashes private material.

## Secret domains

Every row is an independent compromise domain. Reusing a value is forbidden.

| Credential                     | Purpose                                | Rotation consequence                                                                                                                                                    |
| ------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`           | sessions and authentication            | current sessions become invalid; schedule a user-visible re-login window                                                                                                |
| `BACKUP_SIGNING_SECRET`        | signed logical export manifests        | existing exports cannot be restored after a single-key rotation; retain the old secret only in a time-limited offline recovery escrow until the retention window closes |
| `LOCAL_DATA_ENCRYPTION_SECRET` | per-user local PowerSync database keys | local caches become unreadable and must be safely rebuilt from the server; verify outboxes are empty first                                                              |
| `OPS_METRICS_TOKEN`            | protected SLO endpoint                 | no overlap support; update scraper and API in a monitored window as described in the observability runbook                                                              |
| PowerSync keyring              | sync JWT signing                       | supports public-key overlap; never reuse the LuckyOS ring                                                                                                               |
| LuckyOS keyring                | employee bridge JWT signing            | supports public-key overlap; never reuse the PowerSync ring                                                                                                             |
| VAPID keypair                  | push subscription identity             | existing browser subscriptions may need renewal                                                                                                                         |
| Provider credentials           | Resend, Google, Anthropic              | provider-specific outage until every replica uses the new credential                                                                                                    |
| `BACKUP_ENCRYPTION_PASSPHRASE` | encrypted PostgreSQL backup job only   | old backups require the old passphrase; it does not belong in the API environment                                                                                       |

## Standard rotation sequence

1. Declare the credential, owner, reason, start time, rollback value, and validation signal. Confirm that backups and audit logging are healthy.
2. Generate a new random value in the secrets manager. Do not copy it into chat or a local `.env` file.
3. Where overlap is supported, publish the new verifier first, wait longer than the maximum token/cache lifetime, switch the signer, verify, then remove the old verifier. For PowerSync and LuckyOS, keep old keys public-only and keep exactly one current private key.
4. Where overlap is not supported, schedule a monitored maintenance window, update all consumers and replicas, and verify the old value is rejected. Expect the documented consequence rather than hiding it with unsafe dual-secret logic.
5. Re-run `pnpm verify:production-config`, readiness, authorized/unauthorized probes, and the feature-specific smoke test. Inspect SLOs through at least one normal polling interval.
6. Revoke the old value, record completion without recording the value, and remove time-limited recovery escrow when its retention expires.

Never rotate `LOCAL_DATA_ENCRYPTION_SECRET` while clients may have unsynced outbox entries. Never delete an old export-signing or backup-encryption value until the corresponding recovery artifacts have expired or have been reissued and verified. A PowerSync/LuckyOS rotation is complete only after a token signed by the new key succeeds and one signed by the retired key fails after the overlap window.

## Emergency compromise

Stop affected writes, revoke the credential at its authority, isolate logs and artifacts that may contain it, and rotate only the compromised domain plus any value that was improperly reused. Force session revocation for auth compromise, rebuild local caches for local-data-key compromise, and run a restore drill for backup-key compromise. Record user impact and the measured recovery interval in the incident review.
