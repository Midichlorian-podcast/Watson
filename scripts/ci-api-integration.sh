#!/usr/bin/env bash
set -euo pipefail

API_URL="http://127.0.0.1:8790"
API_PID=""
API_LOG="${RUNNER_TEMP:-/tmp}/watson-api-integration.log"

export API_PORT=8790
export BETTER_AUTH_URL="$API_URL"
export WEB_ORIGIN="http://localhost:5173"
export AUTH_ALLOW_SIGNUP=0
export DEV_AUTH_LOG_LINKS=1
export BETTER_AUTH_SECRET="ci-better-auth-secret-at-least-32-bytes-long"
export BACKUP_SIGNING_SECRET="ci-backup-signing-secret-at-least-32-bytes"
export LOCAL_DATA_ENCRYPTION_SECRET="ci-local-data-secret-at-least-32-bytes-long"

stop_api() {
	if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
		kill "$API_PID"
		wait "$API_PID" 2>/dev/null || true
	fi
	API_PID=""
}

cleanup() {
	stop_api
}
trap cleanup EXIT

start_api() {
	local require_2fa="$1"
	: > "$API_LOG"
	AUTH_REQUIRE_PRIVILEGED_2FA="$require_2fa" node --import tsx apps/api/src/index.ts >"$API_LOG" 2>&1 &
	API_PID=$!
	for _ in $(seq 1 60); do
		if curl --fail --silent "$API_URL/health/ready" >/dev/null; then
			return
		fi
		if ! kill -0 "$API_PID" 2>/dev/null; then
			cat "$API_LOG"
			exit 1
		fi
		sleep 0.25
	done
	cat "$API_LOG"
	echo "Watson API readiness timeout" >&2
	exit 1
}

# DB-only invariants run on a clean migrated PostgreSQL and create their own fixtures.
pnpm --filter @watson/api verify:contract
pnpm --filter @watson/api verify:drizzle
pnpm --filter @watson/api verify:reminders
pnpm --filter @watson/api verify:employee-reconcile
pnpm --filter @watson/api verify:db-invariants
pnpm --filter @watson/api verify:signing-keys

# Domain/API suite: privileged 2FA gate is disabled so each test can isolate its own concern.
start_api 0
RBAC_API="$API_URL" pnpm --filter @watson/api verify:rbac
RBAC_API="$API_URL" pnpm --filter @watson/api verify:sync-refs
DECISIONS_API="$API_URL" pnpm --filter @watson/api verify:comment-decisions
COMMENT_COLLAB_API="$API_URL" pnpm --filter @watson/api verify:comment-collaboration
SAVED_VIEWS_API="$API_URL" pnpm --filter @watson/api verify:saved-views
PROJECT_PRESETS_API="$API_URL" pnpm --filter @watson/api verify:project-presets
TASK_DEPENDENCIES_API="$API_URL" pnpm --filter @watson/api verify:task-dependencies
TASK_TIMELINE_API="$API_URL" pnpm --filter @watson/api verify:task-timeline
RBAC_API="$API_URL" pnpm --filter @watson/api verify:meet-acl
MEETING_API="$API_URL" pnpm --filter @watson/api verify:meeting-commands
AI_POLICY_API="$API_URL" pnpm --filter @watson/api verify:ai-policy
TASK_DELETE_API="$API_URL" pnpm --filter @watson/api verify:task-delete
RBAC_API="$API_URL" pnpm --filter @watson/api verify:workspace-policy
EXPORT_API="$API_URL" pnpm --filter @watson/api verify:export
CHAIN_API="$API_URL" pnpm --filter @watson/api verify:manual-chain-gate
VALIDATION_API="$API_URL" pnpm --filter @watson/api verify:input-observability
# Rate-limit suite záměrně poslední: spotřebuje celý /api/watson bucket.
RATE_LIMIT_API="$API_URL" pnpm --filter @watson/api verify:rate-limit
stop_api

# Samostatný restart dokazuje produkční 2FA enforcement, ne pouze helper funkce.
start_api 1
AUTH_API="$API_URL" pnpm --filter @watson/api verify:auth-security
