#!/usr/bin/env bash
set -euo pipefail

API_URL="http://127.0.0.1:8790"
API_PID=""
LUCKYOS_STUB_PID=""
EMAIL_STUB_PID=""
MAIL_GOOGLE_STUB_PID=""
API_LOG="${RUNNER_TEMP:-/tmp}/watson-api-integration.log"
RUN_NONCE="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"

export API_PORT=8790
export BETTER_AUTH_URL="$API_URL"
export WEB_ORIGIN="http://localhost:5173"
export AUTH_ALLOW_SIGNUP=0
export DEV_AUTH_LOG_LINKS=1
# Rate-limit principal je záměrně svázaný s auth secret. Jedinečný testovací secret
# udrží opakované lokální běhy izolované, aniž bychom mazali sdílenou DB tabulku.
export BETTER_AUTH_SECRET="ci-better-auth-secret-${RUN_NONCE}-at-least-32-bytes-long"
export BACKUP_SIGNING_SECRET="ci-backup-signing-secret-at-least-32-bytes"
export LOCAL_DATA_ENCRYPTION_SECRET="ci-local-data-secret-at-least-32-bytes-long"
export MAIL_VAULT_KEYS_JSON='{"version":1,"currentKid":"ci-mail","keys":{"ci-mail":"WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo"}}'
export OPS_METRICS_TOKEN="ci-ops-metrics-token-${RUN_NONCE}-at-least-32-bytes"
# Test nesmí omylem převzít reálný LuckyOS z lokálního .env. Lokální provider
# ověřuje bridge JWT a dovolí otestovat celý revoke/reconnect lifecycle bez sítě.
export LUCKYOS_BASE_URL="http://127.0.0.1:8791"
export LUCKYOS_MOCK=0
export RESEND_API_KEY="re_ci_provider_key"
export RESEND_API_BASE_URL="http://127.0.0.1:8792"
export AUTH_EMAIL_FROM="Watson CI <auth@watson.test>"
export REMINDER_EMAIL_FROM="Watson CI <reminders@watson.test>"
export MAIL_GOOGLE_CLIENT_ID="mail-google-ci-client"
export MAIL_GOOGLE_CLIENT_SECRET="mail-google-ci-secret"
export MAIL_GOOGLE_REDIRECT_URI="$API_URL/api/mail/oauth/google/callback"
export MAIL_GOOGLE_AUTH_URL="http://127.0.0.1:8793/oauth2/v2/auth"
export MAIL_GOOGLE_TOKEN_URL="http://127.0.0.1:8793/token"
export MAIL_GOOGLE_API_BASE_URL="http://127.0.0.1:8793"
export MAIL_GOOGLE_REVOKE_URL="http://127.0.0.1:8793/revoke"

stop_api() {
	if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
		kill "$API_PID"
		wait "$API_PID" 2>/dev/null || true
	fi
	API_PID=""
}

cleanup() {
	stop_api
	if [[ -n "$LUCKYOS_STUB_PID" ]] && kill -0 "$LUCKYOS_STUB_PID" 2>/dev/null; then
		kill "$LUCKYOS_STUB_PID"
		wait "$LUCKYOS_STUB_PID" 2>/dev/null || true
	fi
	if [[ -n "$EMAIL_STUB_PID" ]] && kill -0 "$EMAIL_STUB_PID" 2>/dev/null; then
		kill "$EMAIL_STUB_PID"
		wait "$EMAIL_STUB_PID" 2>/dev/null || true
	fi
	if [[ -n "$MAIL_GOOGLE_STUB_PID" ]] && kill -0 "$MAIL_GOOGLE_STUB_PID" 2>/dev/null; then
		kill "$MAIL_GOOGLE_STUB_PID"
		wait "$MAIL_GOOGLE_STUB_PID" 2>/dev/null || true
	fi
}
trap cleanup EXIT

node apps/api/verify-luckyos-provider-stub.mjs >"${RUNNER_TEMP:-/tmp}/watson-luckyos-stub.log" 2>&1 &
LUCKYOS_STUB_PID=$!
node apps/api/verify-email-provider-stub.mjs >"${RUNNER_TEMP:-/tmp}/watson-email-stub.log" 2>&1 &
EMAIL_STUB_PID=$!
node apps/api/verify-mail-google-provider-stub.mjs >"${RUNNER_TEMP:-/tmp}/watson-mail-google-stub.log" 2>&1 &
MAIL_GOOGLE_STUB_PID=$!
for _ in $(seq 1 40); do
	if curl --fail --silent "http://127.0.0.1:8791/health" >/dev/null; then
		break
	fi
	if ! kill -0 "$LUCKYOS_STUB_PID" 2>/dev/null; then
		cat "${RUNNER_TEMP:-/tmp}/watson-luckyos-stub.log"
		exit 1
	fi
	sleep 0.1
done
for _ in $(seq 1 40); do
	if curl --fail --silent "http://127.0.0.1:8793/health" >/dev/null; then
		break
	fi
	if ! kill -0 "$MAIL_GOOGLE_STUB_PID" 2>/dev/null; then
		cat "${RUNNER_TEMP:-/tmp}/watson-mail-google-stub.log"
		exit 1
	fi
	sleep 0.1
done
for _ in $(seq 1 40); do
	if curl --fail --silent "http://127.0.0.1:8792/health" >/dev/null; then
		break
	fi
	if ! kill -0 "$EMAIL_STUB_PID" 2>/dev/null; then
		cat "${RUNNER_TEMP:-/tmp}/watson-email-stub.log"
		exit 1
	fi
	sleep 0.1
done

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
pnpm --filter @watson/api verify:mail-vault
pnpm --filter @watson/api verify:mail-foundation
pnpm --filter @watson/api verify:mail-content-vault
pnpm --filter @watson/api verify:employee-reconcile
pnpm --filter @watson/api verify:luckyos-v1
pnpm --filter @watson/api verify:db-invariants
pnpm --filter @watson/api verify:signing-keys

# Domain/API suite: privileged 2FA gate is disabled so each test can isolate its own concern.
start_api 0
RBAC_API="$API_URL" pnpm --filter @watson/api verify:rbac
RBAC_API="$API_URL" pnpm --filter @watson/api verify:sync-refs
DECISIONS_API="$API_URL" pnpm --filter @watson/api verify:comment-decisions
DECISION_LOG_API="$API_URL" pnpm --filter @watson/api verify:decisions
RADAR_API="$API_URL" pnpm --filter @watson/api verify:radar
AUTOMATION_API="$API_URL" pnpm --filter @watson/api verify:automation
KNOWLEDGE_API="$API_URL" pnpm --filter @watson/api verify:knowledge
COMMENT_COLLAB_API="$API_URL" pnpm --filter @watson/api verify:comment-collaboration
TASK_BULK_API="$API_URL" pnpm --filter @watson/api verify:task-bulk
SAVED_VIEWS_API="$API_URL" pnpm --filter @watson/api verify:saved-views
PROJECT_PRESETS_API="$API_URL" pnpm --filter @watson/api verify:project-presets
TASK_DEPENDENCIES_API="$API_URL" pnpm --filter @watson/api verify:task-dependencies
TASK_TIMELINE_API="$API_URL" pnpm --filter @watson/api verify:task-timeline
ATTACHMENTS_API="$API_URL" pnpm --filter @watson/api verify:attachments
CUSTOM_FIELDS_API="$API_URL" pnpm --filter @watson/api verify:custom-fields
POLLS_API="$API_URL" pnpm --filter @watson/api verify:polls
INTAKE_FORMS_API="$API_URL" pnpm --filter @watson/api verify:intake-forms
TASK_ACCEPTANCES_API="$API_URL" pnpm --filter @watson/api verify:task-acceptances
IMPORTS_API="$API_URL" pnpm --filter @watson/api verify:imports
AVAILABILITY_API="$API_URL" pnpm --filter @watson/api verify:availability
BOOKING_API="$API_URL" pnpm --filter @watson/api verify:bookings
INTEGRATIONS_API="$API_URL" pnpm --filter @watson/api verify:integrations
EMPLOYEE_HUB_API="$API_URL" pnpm --filter @watson/api verify:employee-hub
MAIL_API="$API_URL" pnpm --filter @watson/api verify:mail-google
MAIL_API="$API_URL" pnpm --filter @watson/api verify:mail-sync
MAIL_API="$API_URL" pnpm --filter @watson/api verify:mail-execution
MAIL_API="$API_URL" pnpm --filter @watson/api verify:mail-outbound
RECURRENCE_API="$API_URL" pnpm --filter @watson/api verify:recurrence
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

# LuckyOS v1 běží v samostatném explicitním procesu. Tím test zároveň dokazuje,
# že nedochází k tichému přepnutí legacy kontraktu ani ke sdílení env konfigurace.
export LUCKYOS_PROTOCOL="v1"
export LUCKYOS_ORGANIZATION_ID="watson-luckyos-self-service-test"
export LUCKYOS_WEBHOOK_SIGNING_SECRET="ci-luckyos-webhook-signing-secret-at-least-32-bytes"
start_api 0
EMPLOYEE_SELF_SERVICE_API="$API_URL" pnpm --filter @watson/api verify:employee-self-service
stop_api

# Samostatný restart dokazuje produkční 2FA enforcement, ne pouze helper funkce.
start_api 1
AUTH_API="$API_URL" pnpm --filter @watson/api verify:auth-security
