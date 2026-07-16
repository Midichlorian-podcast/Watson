#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL must point to the authoritative Watson PostgreSQL database}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
if (( ${#BACKUP_ENCRYPTION_PASSPHRASE} < 20 )); then
	echo "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 20 characters." >&2
	exit 1
fi

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
base="$BACKUP_DIR/watson-postgres-$timestamp-$$"
encrypted_tmp="$base.dump.gpg.tmp"
checksum_tmp="$base.dump.gpg.sha256.tmp"
if [[ -e "$base.dump.gpg" || -e "$base.dump.gpg.sha256" ]]; then
	echo "Refusing to overwrite an existing backup artifact." >&2
	exit 1
fi
plain="$(mktemp "${TMPDIR:-/tmp}/watson-backup.XXXXXX.dump")"

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
	read -r encrypted_checksum _ < <(sha256sum "$encrypted_tmp")
else
	read -r encrypted_checksum _ < <(shasum -a 256 "$encrypted_tmp")
fi
printf '%s  %s\n' "$encrypted_checksum" "$(basename "$base.dump.gpg")" >"$checksum_tmp"

mv "$encrypted_tmp" "$base.dump.gpg"
mv "$checksum_tmp" "$base.dump.gpg.sha256"
trap - EXIT INT TERM
rm -f "$plain"

echo "Backup created and catalog-verified: $base.dump.gpg"
echo "Upload both .dump.gpg and .sha256 to immutable off-site storage; local creation is not retention."
