#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${1:?Usage: restore-drill.sh /path/to/watson-postgres-*.dump.gpg}"
: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL must point to an isolated drill database}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${ALLOW_DESTRUCTIVE_RESTORE_DRILL:?Set ALLOW_DESTRUCTIVE_RESTORE_DRILL=YES after checking the isolated target}"

if [[ "$ALLOW_DESTRUCTIVE_RESTORE_DRILL" != "YES" ]]; then
	echo "Refusing restore: ALLOW_DESTRUCTIVE_RESTORE_DRILL must equal YES." >&2
	exit 1
fi
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_TARGET_DATABASE_URL" == "$DATABASE_URL" ]]; then
	echo "Refusing restore: target is identical to source DATABASE_URL." >&2
	exit 1
fi

encrypted="$1"
checksum_file="$encrypted.sha256"
[[ -f "$encrypted" ]] || { echo "Backup not found: $encrypted" >&2; exit 1; }
[[ -f "$checksum_file" ]] || { echo "Checksum not found: $checksum_file" >&2; exit 1; }

for binary in pg_restore psql node; do
	command -v "$binary" >/dev/null || {
		echo "Missing required binary: $binary" >&2
		exit 1
	}
done

checksum_dir="$(cd "$(dirname "$encrypted")" && pwd)"
checksum_name="$(basename "$checksum_file")"
if command -v sha256sum >/dev/null; then
	(cd "$checksum_dir" && sha256sum --check "$checksum_name")
else
	(cd "$checksum_dir" && shasum -a 256 -c "$checksum_name")
fi

plain="$(mktemp "${TMPDIR:-/tmp}/watson-restore.XXXXXX.dump")"
script_dir="$(cd "$(dirname "$0")" && pwd)"
report="${RESTORE_REPORT_PATH:-./restore-drill-$(date -u +%Y%m%dT%H%M%SZ).json}"
cleanup() { rm -f "$plain"; }
trap cleanup EXIT INT TERM

node "$script_dir/crypto.mjs" decrypt "$encrypted" "$plain"
pg_restore --list "$plain" >/dev/null

public_tables="$(psql "$RESTORE_TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
	-c "select count(*) from pg_tables where schemaname='public';")"
if [[ "$public_tables" != "0" && "${ALLOW_NONEMPTY_RESTORE_TARGET:-NO}" != "YES" ]]; then
	echo "Refusing restore: target contains $public_tables public tables. Use a clean drill DB." >&2
	exit 1
fi

started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pg_restore \
	--dbname="$RESTORE_TARGET_DATABASE_URL" \
	--exit-on-error \
	--no-owner \
	--no-acl \
	"$plain"

integrity="$(psql "$RESTORE_TARGET_DATABASE_URL" -X -A -t -F ',' -v ON_ERROR_STOP=1 <<'SQL'
select
  (select count(*) from tasks t left join projects p on p.id=t.project_id where p.id is null),
  (select count(*) from assignments a left join tasks t on t.id=a.task_id where t.id is null),
  (select count(*) from comments c left join tasks t on t.id=c.task_id where t.id is null),
  (select count(*) from meetings m left join tasks t on t.id=m.hub_task_id where m.hub_task_id is not null and t.id is null),
  (select count(*) from memberships m left join users u on u.id=m.user_id left join workspaces w on w.id=m.workspace_id where u.id is null or w.id is null),
  (select count(*) from drizzle.__drizzle_migrations);
SQL
)"
IFS=',' read -r orphan_tasks orphan_assignments orphan_comments orphan_meetings orphan_memberships migrations <<<"$integrity"
if [[ "$orphan_tasks" != "0" || "$orphan_assignments" != "0" || "$orphan_comments" != "0" || "$orphan_meetings" != "0" || "$orphan_memberships" != "0" ]]; then
	echo "Restore integrity failed: $integrity" >&2
	exit 1
fi

finished_epoch="$(date +%s)"
duration="$((finished_epoch - started_epoch))"
rto_target="${RTO_TARGET_SECONDS:-7200}"
if (( duration > rto_target )); then
	echo "Restore completed but exceeded RTO target: ${duration}s > ${rto_target}s" >&2
	exit 1
fi

cat >"$report" <<JSON
{
  "status": "passed",
  "backup": "$(basename "$encrypted")",
  "startedAt": "$started_at",
  "durationSeconds": $duration,
  "rtoTargetSeconds": $rto_target,
  "migrations": $migrations,
  "orphans": {
    "tasks": $orphan_tasks,
    "assignments": $orphan_assignments,
    "comments": $orphan_comments,
    "meetings": $orphan_meetings,
    "memberships": $orphan_memberships
  }
}
JSON

echo "Restore drill passed in ${duration}s. Report: $report"
