# Watson backup, PITR and restore runbook

The product has two separate recovery layers. They must not be conflated:

1. The signed application export in Settings restores missing logical rows without overwriting existing IDs.
2. PostgreSQL backup plus WAL/PITR recovers a destroyed database or a bad deployment. External attachment object storage needs its own versioned backup.

## Production release gate

- `DATABASE_URL`, a high-entropy `BACKUP_ENCRYPTION_PASSPHRASE` (at least 20 characters), and a write-only off-site destination are supplied by the secrets/platform layer. The scripts require Node.js and PostgreSQL client tools; encryption is authenticated AES-256-GCM with PBKDF2-SHA256 and a random salt/nonce.
- Run `backup-postgres.sh` at least every 24 hours. Upload the encrypted dump and checksum to immutable storage; never retain the only copy on the database host.
- The PostgreSQL platform must continuously archive WAL with a retention window of at least 7 days. Alert when the newest archived WAL is older than 15 minutes. This is what provides the agreed RPO ≤15 minutes; periodic dumps alone do not.
- Retain daily dumps for 14 days, weekly dumps for 8 weeks, and monthly dumps for 12 months unless the data-retention policy is stricter.
- Back up external attachment/object storage with versioning and the same retention class. Calendar, OAuth, signing, auth, and backup secrets live in the secrets manager and have independent recovery/rotation procedures.
- Never put the passphrase, database URL, private keys, decrypted dump, or restore report containing record values into CI logs.

## Quarterly restore drill

1. Provision a new isolated PostgreSQL instance with network access restricted to the operator/CI job.
2. Set `RESTORE_TARGET_DATABASE_URL`; set `ALLOW_DESTRUCTIVE_RESTORE_DRILL=YES` only after confirming it is not the production URL.
3. Download one encrypted dump and its `.sha256` sidecar from off-site storage.
4. Run `restore-drill.sh`. It refuses a non-empty target by default, verifies the encrypted checksum and dump catalog, restores with `--exit-on-error`, checks key orphan invariants, and fails when RTO exceeds 7,200 seconds.
5. Run API integration tests and a read-only smoke login against the restored environment. Store the generated JSON report with the incident/release evidence, not with the user data.
6. Destroy the isolated database and any decrypted temporary storage.

For a no-install local rehearsal, run `local-docker-drill.sh` while the repository's PostgreSQL container is healthy. It creates a uniquely named isolated database in the same container, performs an authenticated-encryption round trip, restores and validates it, writes `RESTORE_DRILL_LOCAL.json`, then drops the drill database. This is useful evidence that the dump and schema are restorable, but it does not prove production object-storage retention or WAL/PITR.

## Incident restore

- Stop application writes first and record the incident timestamp.
- Choose PITR time strictly before the destructive event; restore into a new database, never over the only production copy.
- Run the same integrity and application test suite as the quarterly drill.
- Switch application traffic only after sign-off. Preserve the old database read-only until the post-incident review.
- Record measured RPO (last confirmed transaction versus incident) and RTO (incident declaration to healthy traffic), data gaps, key rotations, and follow-up actions.

The solo-operator constraint makes automation mandatory: a successful backup command is not evidence of recoverability; only a dated restore report is.
