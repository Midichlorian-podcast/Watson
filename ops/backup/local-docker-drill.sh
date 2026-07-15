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
created_db=0

cleanup() {
	if [[ "$created_db" == "1" ]]; then
		(cd "$repo_root" && docker compose exec -T postgres dropdb -U watson --if-exists "$drill_db") >/dev/null 2>&1 || true
	fi
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

integrity="$(cd "$repo_root" && docker compose exec -T postgres psql -U watson -d "$drill_db" -X -A -t -F ',' -v ON_ERROR_STOP=1 <<'SQL'
select
  (select count(*) from tasks t left join projects p on p.id=t.project_id where p.id is null),
  (select count(*) from assignments a left join tasks t on t.id=a.task_id where t.id is null),
  (select count(*) from comments c left join tasks t on t.id=c.task_id where t.id is null),
  (select count(*) from meetings m left join tasks t on t.id=m.hub_task_id where m.hub_task_id is not null and t.id is null),
  (select count(*) from memberships m left join users u on u.id=m.user_id left join workspaces w on w.id=m.workspace_id where u.id is null or w.id is null),
  (select count(*) from drizzle.__drizzle_migrations),
  (select count(*) from users),
  (select count(*) from tasks);
SQL
)"
IFS=',' read -r orphan_tasks orphan_assignments orphan_comments orphan_meetings orphan_memberships migrations users_count tasks_count <<<"$integrity"
if [[ "$orphan_tasks" != "0" || "$orphan_assignments" != "0" || "$orphan_comments" != "0" || "$orphan_meetings" != "0" || "$orphan_memberships" != "0" ]]; then
	echo "Local restore integrity failed: $integrity" >&2
	exit 1
fi

duration="$(( $(date +%s) - started_epoch ))"
rto_target="${RTO_TARGET_SECONDS:-7200}"
if (( duration > rto_target )); then
	echo "Local drill exceeded RTO: ${duration}s > ${rto_target}s" >&2
	exit 1
fi

cat >"$report" <<JSON
{
  "status": "passed",
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
    "memberships": $orphan_memberships
  }
}
JSON

echo "Local encrypted PostgreSQL restore drill passed in ${duration}s."
echo "Evidence: $report"
