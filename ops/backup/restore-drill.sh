#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${1:?Usage: restore-drill.sh /path/to/watson-postgres-*.dump.gpg}"
: "${RESTORE_TARGET_DATABASE_URL:?RESTORE_TARGET_DATABASE_URL must point to an isolated drill database}"
: "${RESTORE_EXPECTED_DATABASE:?RESTORE_EXPECTED_DATABASE must exactly name the isolated target database}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${ALLOW_DESTRUCTIVE_RESTORE_DRILL:?Set ALLOW_DESTRUCTIVE_RESTORE_DRILL=YES after checking the isolated target}"

if [[ "$ALLOW_DESTRUCTIVE_RESTORE_DRILL" != "YES" ]]; then
	echo "Refusing restore: ALLOW_DESTRUCTIVE_RESTORE_DRILL must equal YES." >&2
	exit 1
fi
if (( ${#BACKUP_ENCRYPTION_PASSPHRASE} < 20 )); then
	echo "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 20 characters." >&2
	exit 1
fi
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_TARGET_DATABASE_URL" == "$DATABASE_URL" ]]; then
	echo "Refusing restore: target is identical to source DATABASE_URL." >&2
	exit 1
fi

encrypted="$1"
checksum_file="$encrypted.sha256"
backup_name="$(basename "$encrypted")"
if [[ ! "$backup_name" =~ ^[A-Za-z0-9._-]{1,200}$ ]]; then
	echo "Refusing restore: backup filename contains unsupported characters." >&2
	exit 1
fi
[[ -f "$encrypted" ]] || { echo "Backup not found: $encrypted" >&2; exit 1; }
[[ -f "$checksum_file" ]] || { echo "Checksum not found: $checksum_file" >&2; exit 1; }

for binary in pg_restore psql node; do
	command -v "$binary" >/dev/null || {
		echo "Missing required binary: $binary" >&2
		exit 1
	}
done

started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

checksum_contents="$(<"$checksum_file")"
expected_checksum=""
recorded_name=""
extra_checksum_field=""
read -r expected_checksum recorded_name extra_checksum_field <<<"$checksum_contents"
if [[
	"$checksum_contents" == *$'\n'* ||
	! "$expected_checksum" =~ ^[0-9a-fA-F]{64}$ ||
	"$recorded_name" != "$backup_name" ||
	-n "$extra_checksum_field"
]]; then
	echo "Refusing restore: checksum sidecar has an invalid format." >&2
	exit 1
fi
if command -v sha256sum >/dev/null; then
	read -r actual_checksum _ < <(sha256sum "$encrypted")
else
	read -r actual_checksum _ < <(shasum -a 256 "$encrypted")
fi
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
	echo "Refusing restore: encrypted backup checksum mismatch." >&2
	exit 1
fi

plain="$(mktemp "${TMPDIR:-/tmp}/watson-restore.XXXXXX.dump")"
script_dir="$(cd "$(dirname "$0")" && pwd)"
report="${RESTORE_REPORT_PATH:-./restore-drill-$(date -u +%Y%m%dT%H%M%SZ).json}"
report_tmp=""
cleanup() {
	rm -f "$plain"
	[[ -z "$report_tmp" ]] || rm -f "$report_tmp"
}
trap cleanup EXIT INT TERM

node "$script_dir/crypto.mjs" decrypt "$encrypted" "$plain"
pg_restore --list "$plain" >/dev/null

public_tables="$(psql "$RESTORE_TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
	-c "select count(*) from pg_tables where schemaname='public';")"
target_database="$(psql "$RESTORE_TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select current_database();")"
if [[ "$target_database" != "$RESTORE_EXPECTED_DATABASE" ]]; then
	echo "Refusing restore: connected database does not match RESTORE_EXPECTED_DATABASE." >&2
	exit 1
fi
if [[ "$public_tables" != "0" ]]; then
	echo "Refusing restore: target is not empty. Provision a clean isolated database." >&2
	exit 1
fi

pg_restore \
	--dbname="$RESTORE_TARGET_DATABASE_URL" \
	--exit-on-error \
	--no-owner \
	--no-acl \
	"$plain"

integrity="$(psql "$RESTORE_TARGET_DATABASE_URL" -X -A -t -F ',' -v ON_ERROR_STOP=1 -f "$script_dir/restore-integrity.sql")"
IFS=',' read -r orphan_tasks orphan_assignments orphan_comments orphan_meetings orphan_memberships orphan_project_members access_membership_scope assignment_membership_scope task_parent_scope meeting_task_scope availability_scope booking_scope intake_scope migrations users_count tasks_count <<<"$integrity"
violations=(
	"$orphan_tasks" "$orphan_assignments" "$orphan_comments" "$orphan_meetings"
	"$orphan_memberships" "$orphan_project_members" "$access_membership_scope"
	"$assignment_membership_scope" "$task_parent_scope" "$meeting_task_scope"
	"$availability_scope" "$booking_scope" "$intake_scope"
)
for value in "${violations[@]}" "$migrations" "$users_count" "$tasks_count"; do
	if [[ ! "$value" =~ ^[0-9]+$ ]]; then
		echo "Restore integrity returned a malformed counter." >&2
		exit 1
	fi
done
if [[ "${violations[*]}" != "0 0 0 0 0 0 0 0 0 0 0 0 0" ]]; then
	echo "Restore integrity failed: $integrity" >&2
	exit 1
fi

finished_epoch="$(date +%s)"
duration="$((finished_epoch - started_epoch))"
rto_target="${RTO_TARGET_SECONDS:-7200}"
if [[ ! "$rto_target" =~ ^[1-9][0-9]*$ ]]; then
	echo "RTO_TARGET_SECONDS must be a positive integer." >&2
	exit 1
fi
if (( duration > rto_target )); then
	echo "Restore completed but exceeded RTO target: ${duration}s > ${rto_target}s" >&2
	exit 1
fi

mkdir -p "$(dirname "$report")"
report_tmp="$(mktemp "$report.tmp.XXXXXX")"
cat >"$report_tmp" <<JSON
{
  "status": "passed",
  "backup": "$backup_name",
  "startedAt": "$started_at",
  "durationSeconds": $duration,
  "rtoTargetSeconds": $rto_target,
  "migrations": $migrations,
  "users": $users_count,
  "tasks": $tasks_count,
  "orphans": {
    "tasks": $orphan_tasks,
    "assignments": $orphan_assignments,
    "comments": $orphan_comments,
    "meetings": $orphan_meetings,
    "memberships": $orphan_memberships,
    "projectMembers": $orphan_project_members,
    "accessMembershipScope": $access_membership_scope,
    "assignmentMembershipScope": $assignment_membership_scope,
    "taskParentScope": $task_parent_scope,
    "meetingTaskScope": $meeting_task_scope,
    "availabilityScope": $availability_scope,
    "bookingScope": $booking_scope,
    "intakeScope": $intake_scope
  }
}
JSON
chmod 0600 "$report_tmp"
mv -f "$report_tmp" "$report"
report_tmp=""

echo "Restore drill passed in ${duration}s. Report: $report"
