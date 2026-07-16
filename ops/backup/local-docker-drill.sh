#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${BACKUP_ENCRYPTION_PASSPHRASE:?Use a throwaway 20+ character passphrase for the local drill}"
if (( ${#BACKUP_ENCRYPTION_PASSPHRASE} < 20 )); then
	echo "BACKUP_ENCRYPTION_PASSPHRASE must contain at least 20 characters." >&2
	exit 1
fi

for binary in docker node; do
	command -v "$binary" >/dev/null || { echo "Missing required binary: $binary" >&2; exit 1; }
done

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
drill_db="watson_restore_drill_${timestamp}_$$"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/watson-local-drill.XXXXXX")"
plain="$work_dir/source.dump"
encrypted="$work_dir/source.dump.gpg"
restored_plain="$work_dir/restored.dump"
report="${RESTORE_REPORT_PATH:-$repo_root/ops/backup/RESTORE_DRILL_LOCAL.json}"
report_tmp=""
created_db=0

cleanup() {
	if [[ "$created_db" == "1" ]]; then
		(cd "$repo_root" && docker compose exec -T postgres dropdb -U watson --if-exists "$drill_db") >/dev/null 2>&1 || true
	fi
	[[ -z "$report_tmp" ]] || rm -f "$report_tmp"
	rm -rf "$work_dir"
}
trap cleanup EXIT INT TERM

started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
(cd "$repo_root" && docker compose exec -T postgres pg_dump -U watson -d watson -Fc -Z 9) >"$plain"
(cd "$repo_root" && docker compose exec -T postgres pg_restore --list) <"$plain" >/dev/null
node "$script_dir/crypto.mjs" encrypt "$plain" "$encrypted"
node "$script_dir/crypto.mjs" decrypt "$encrypted" "$restored_plain"
cmp -s "$plain" "$restored_plain" || { echo "Encrypted backup round-trip mismatch." >&2; exit 1; }

(cd "$repo_root" && docker compose exec -T postgres createdb -U watson "$drill_db")
created_db=1
(cd "$repo_root" && docker compose exec -T postgres pg_restore -U watson -d "$drill_db" --exit-on-error --no-owner --no-acl) <"$restored_plain"

integrity="$(cd "$repo_root" && docker compose exec -T postgres psql -U watson -d "$drill_db" -X -A -t -F ',' -v ON_ERROR_STOP=1 <"$script_dir/restore-integrity.sql")"
IFS=',' read -r orphan_tasks orphan_assignments orphan_comments orphan_meetings orphan_memberships orphan_project_members access_membership_scope assignment_membership_scope task_parent_scope meeting_task_scope availability_scope booking_scope intake_scope migrations users_count tasks_count <<<"$integrity"
violations=(
	"$orphan_tasks" "$orphan_assignments" "$orphan_comments" "$orphan_meetings"
	"$orphan_memberships" "$orphan_project_members" "$access_membership_scope"
	"$task_parent_scope" "$meeting_task_scope"
	"$availability_scope" "$booking_scope" "$intake_scope"
)
for value in "${violations[@]}" "$assignment_membership_scope" "$migrations" "$users_count" "$tasks_count"; do
	if [[ ! "$value" =~ ^[0-9]+$ ]]; then
		echo "Local restore integrity returned a malformed counter." >&2
		exit 1
	fi
done
if [[ "${violations[*]}" != "0 0 0 0 0 0 0 0 0 0 0 0" ]]; then
	echo "Local restore integrity failed: $integrity" >&2
	exit 1
fi
report_status="passed"
if [[ "$assignment_membership_scope" != "0" ]]; then
	report_status="passed_with_warnings"
	echo "Local restore warning: $assignment_membership_scope legacy assignment membership gap(s); production restore rejects these." >&2
fi

duration="$(( $(date +%s) - started_epoch ))"
rto_target="${RTO_TARGET_SECONDS:-7200}"
if [[ ! "$rto_target" =~ ^[1-9][0-9]*$ ]]; then
	echo "RTO_TARGET_SECONDS must be a positive integer." >&2
	exit 1
fi
if (( duration > rto_target )); then
	echo "Local drill exceeded RTO: ${duration}s > ${rto_target}s" >&2
	exit 1
fi

mkdir -p "$(dirname "$report")"
report_tmp="$(mktemp "$report.tmp.XXXXXX")"
cat >"$report_tmp" <<JSON
{
  "status": "$report_status",
  "environment": "local-docker-isolated-database",
  "startedAt": "$started_at",
  "durationSeconds": $duration,
  "rtoTargetSeconds": $rto_target,
  "encryptedRoundTrip": true,
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
    "taskParentScope": $task_parent_scope,
    "meetingTaskScope": $meeting_task_scope,
    "availabilityScope": $availability_scope,
    "bookingScope": $booking_scope,
    "intakeScope": $intake_scope
  },
  "warnings": {
    "legacyAssignmentMembershipScope": $assignment_membership_scope
  }
}
JSON
chmod 0600 "$report_tmp"
mv -f "$report_tmp" "$report"
report_tmp=""

echo "Local encrypted PostgreSQL restore drill passed in ${duration}s."
echo "Evidence: $report"
