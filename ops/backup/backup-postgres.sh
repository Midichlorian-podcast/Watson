#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL must point to the authoritative Watson PostgreSQL database}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

for binary in pg_dump pg_restore node; do
	command -v "$binary" >/dev/null || {
		echo "Missing required binary: $binary" >&2
		exit 1
	}
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
script_dir="$(cd "$(dirname "$0")" && pwd)"
base="$BACKUP_DIR/watson-postgres-$timestamp"
plain="$(mktemp "${TMPDIR:-/tmp}/watson-backup.XXXXXX.dump")"
encrypted_tmp="$base.dump.gpg.tmp"
checksum_tmp="$base.dump.gpg.sha256.tmp"

cleanup() {
	rm -f "$plain" "$encrypted_tmp" "$checksum_tmp"
}
trap cleanup EXIT INT TERM

pg_dump \
	--dbname="$DATABASE_URL" \
	--format=custom \
	--compress=9 \
	--no-owner \
	--no-acl \
	--file="$plain"

# A syntactically produced file is not enough: prove that pg_restore can read its catalog.
pg_restore --list "$plain" >/dev/null

node "$script_dir/crypto.mjs" encrypt "$plain" "$encrypted_tmp"

if command -v sha256sum >/dev/null; then
	sha256sum "$encrypted_tmp" | sed "s#${encrypted_tmp}#$(basename "$base.dump.gpg")#" >"$checksum_tmp"
else
	shasum -a 256 "$encrypted_tmp" | sed "s#${encrypted_tmp}#$(basename "$base.dump.gpg")#" >"$checksum_tmp"
fi

mv "$encrypted_tmp" "$base.dump.gpg"
mv "$checksum_tmp" "$base.dump.gpg.sha256"
trap - EXIT INT TERM
rm -f "$plain"

echo "Backup created and catalog-verified: $base.dump.gpg"
echo "Upload both .dump.gpg and .sha256 to immutable off-site storage; local creation is not retention."
