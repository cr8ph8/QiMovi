#!/usr/bin/env bash
# Native PostgreSQL two-session proof for same-key project-evidence races.
# This script accepts only a loopback database named `security_regressions`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SQL="supabase/tests/project_evidence_concurrency_setup.sql"
CALL_SQL="supabase/tests/project_evidence_concurrency_call.sql"
PROJECT_ID="96000000-0000-4000-8000-000000000003"
RACE_KEY="native-concurrency:same-key"
RUN_NONCE="$$-$RANDOM"
LOCK_HOLDER_APP="ledger-lock-holder-$RUN_NONCE"
RACER_A_APP="ledger-racer-a-$RUN_NONCE"
RACER_B_APP="ledger-racer-b-$RUN_NONCE"
LOCAL_DATABASE_URL_PATTERN='^postgres(ql)?://([^/@]+@)?(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/security_regressions$'

cd "$ROOT_DIR"

if [[ -z "${SECURITY_TEST_DB_URL:-}" ]]; then
  echo "SECURITY_TEST_DB_URL is required for the concurrency probe." >&2
  exit 2
fi
if [[ ! "$SECURITY_TEST_DB_URL" =~ $LOCAL_DATABASE_URL_PATTERN ]]; then
  echo "Concurrency probe requires a loopback security_regressions database." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for the concurrency probe." >&2
  exit 2
fi
if [[ "$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database()')" != "security_regressions" ]]; then
  echo "Concurrency probe connected to an unexpected database." >&2
  exit 2
fi

TMP_BASE="${TMPDIR:-/tmp}"
RESULT_DIR="$(mktemp -d "$TMP_BASE/qicsw-ledger-race.XXXXXX")"
BLOCKER_PID=""
RACER_A_PID=""
RACER_B_PID=""
BLOCKER_DB_PID=""
RACER_A_DB_PID=""
RACER_B_DB_PID=""

cleanup() {
  local status=$?
  local db_pid_list=""
  set +e
  for candidate in "$BLOCKER_DB_PID" "$RACER_A_DB_PID" "$RACER_B_DB_PID"; do
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      [[ -n "$db_pid_list" ]] && db_pid_list+=","
      db_pid_list+="$candidate"
    fi
  done
  if [[ -n "$db_pid_list" ]]; then
    psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid = ANY(ARRAY[$db_pid_list]::integer[]) AND application_name IN ('$LOCK_HOLDER_APP', '$RACER_A_APP', '$RACER_B_APP') AND pid <> pg_backend_pid()" \
      >/dev/null 2>&1
  fi
  psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -q <<SQL >/dev/null 2>&1
SET session_replication_role = replica;
DELETE FROM public.project_evidence_observation_requests
 WHERE project_id = '$PROJECT_ID'::uuid;
DELETE FROM public.project_evidence_observations
 WHERE project_id = '$PROJECT_ID'::uuid;
SET session_replication_role = origin;
DELETE FROM public.context_bundles
 WHERE id = '96000000-0000-4000-8000-000000000004'::uuid;
DELETE FROM public.project_legacy_map
 WHERE project_id = '$PROJECT_ID'::uuid;
DELETE FROM public.projects WHERE id = '$PROJECT_ID'::uuid;
DELETE FROM public.entries
 WHERE id = '96000000-0000-4000-8000-000000000002'::uuid;
DELETE FROM auth.users
 WHERE id = '96000000-0000-4000-8000-000000000001'::uuid;
UPDATE public.site_settings
   SET value = false, text_value = 'off'
 WHERE key = 'production_review_evidence_v1';
DROP SCHEMA IF EXISTS project_evidence_test CASCADE;
SQL
  [[ -n "$BLOCKER_PID" ]] && wait "$BLOCKER_PID" >/dev/null 2>&1
  [[ -n "$RACER_A_PID" ]] && wait "$RACER_A_PID" >/dev/null 2>&1
  [[ -n "$RACER_B_PID" ]] && wait "$RACER_B_PID" >/dev/null 2>&1
  case "$RESULT_DIR" in
    "$TMP_BASE"/qicsw-ledger-race.*) rm -rf -- "$RESULT_DIR" ;;
    *) echo "Refusing to remove unexpected result directory: $RESULT_DIR" >&2 ;;
  esac
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for_activity_count() {
  local expected="$1"
  local query="$2"
  local label="$3"
  local count=""
  for _attempt in $(seq 1 150); do
    count="$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc "$query")"
    if [[ "$count" == "$expected" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "Timed out waiting for $label (expected $expected, observed ${count:-unknown})." >&2
  psql "$SECURITY_TEST_DB_URL" -X -Atqc \
    "SELECT application_name, state, wait_event_type, wait_event FROM pg_stat_activity WHERE datname = current_database() AND application_name IN ('$LOCK_HOLDER_APP', '$RACER_A_APP', '$RACER_B_APP') ORDER BY application_name" >&2 || true
  return 1
}

psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -f "$SETUP_SQL" >/dev/null

PGAPPNAME="$LOCK_HOLDER_APP" psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -q \
  -c "BEGIN; SELECT 1 FROM public.projects WHERE id = '$PROJECT_ID'::uuid FOR UPDATE; SELECT pg_sleep(20); ROLLBACK;" \
  >"$RESULT_DIR/blocker.out" 2>"$RESULT_DIR/blocker.err" &
BLOCKER_PID=$!

wait_for_activity_count 1 \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name = '$LOCK_HOLDER_APP' AND wait_event = 'PgSleep'" \
  "the lock holder to acquire the project row"
BLOCKER_DB_PID="$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = '$LOCK_HOLDER_APP' AND wait_event = 'PgSleep'")"
if [[ ! "$BLOCKER_DB_PID" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve the lock-holder backend PID." >&2
  exit 1
fi

PGAPPNAME="$RACER_A_APP" psql "$SECURITY_TEST_DB_URL" -X -qAt -F '|' \
  -v ON_ERROR_STOP=1 -v race_key="$RACE_KEY" -f "$CALL_SQL" \
  >"$RESULT_DIR/racer-a.out" 2>"$RESULT_DIR/racer-a.err" &
RACER_A_PID=$!
PGAPPNAME="$RACER_B_APP" psql "$SECURITY_TEST_DB_URL" -X -qAt -F '|' \
  -v ON_ERROR_STOP=1 -v race_key="$RACE_KEY" -f "$CALL_SQL" \
  >"$RESULT_DIR/racer-b.out" 2>"$RESULT_DIR/racer-b.err" &
RACER_B_PID=$!

wait_for_activity_count 2 \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name IN ('$RACER_A_APP', '$RACER_B_APP') AND wait_event_type = 'Lock'" \
  "both evidence writers to block on the same project row"
RACER_A_DB_PID="$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = '$RACER_A_APP' AND wait_event_type = 'Lock'")"
RACER_B_DB_PID="$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND application_name = '$RACER_B_APP' AND wait_event_type = 'Lock'")"
if [[ ! "$RACER_A_DB_PID" =~ ^[0-9]+$ || ! "$RACER_B_DB_PID" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve both racer backend PIDs." >&2
  exit 1
fi

psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid = $BLOCKER_DB_PID AND application_name = '$LOCK_HOLDER_APP'" \
  >/dev/null

set +e
wait "$RACER_A_PID"
RACER_A_STATUS=$?
wait "$RACER_B_PID"
RACER_B_STATUS=$?
wait "$BLOCKER_PID" >/dev/null 2>&1
set -e
RACER_A_PID=""
RACER_B_PID=""
BLOCKER_PID=""

if (( RACER_A_STATUS != 0 || RACER_B_STATUS != 0 )); then
  echo "Concurrent writers failed: A=$RACER_A_STATUS B=$RACER_B_STATUS" >&2
  sed -n '1,120p' "$RESULT_DIR/racer-a.err" >&2
  sed -n '1,120p' "$RESULT_DIR/racer-b.err" >&2
  exit 1
fi

if [[ "$(wc -l < "$RESULT_DIR/racer-a.out" | tr -d ' ')" != "1" \
   || "$(wc -l < "$RESULT_DIR/racer-b.out" | tr -d ' ')" != "1" ]]; then
  echo "Each racer must emit exactly one result row." >&2
  exit 1
fi

OBSERVATION_A="$(cut -d '|' -f 1 "$RESULT_DIR/racer-a.out")"
OBSERVATION_B="$(cut -d '|' -f 1 "$RESULT_DIR/racer-b.out")"
if [[ -z "$OBSERVATION_A" || "$OBSERVATION_A" != "$OBSERVATION_B" ]]; then
  echo "Concurrent idempotent writers returned different observations." >&2
  exit 1
fi

if ! awk -F '|' \
  '$6 == "f" && $7 == "f" && $8 == "EVIDENCE_OBSERVATION_AND_IDEMPOTENCY_REQUEST_APPENDED" { appends += 1 }
   $6 == "t" && $7 == "f" && $8 == "NONE_IDEMPOTENT_REPLAY" { replays += 1 }
   END { exit !(appends == 1 && replays == 1) }' \
  "$RESULT_DIR/racer-a.out" "$RESULT_DIR/racer-b.out"; then
  echo "Race did not resolve to exactly one append and one idempotent replay." >&2
  exit 1
fi

FINAL_COUNTS="$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -AtF '|' -c \
  "SELECT (SELECT count(*) FROM public.project_evidence_observations WHERE project_id = '$PROJECT_ID'::uuid), (SELECT count(*) FROM public.project_evidence_observation_requests WHERE project_id = '$PROJECT_ID'::uuid)")"
if [[ "$FINAL_COUNTS" != "1|1" ]]; then
  echo "Race persisted unexpected row counts: $FINAL_COUNTS" >&2
  exit 1
fi

echo "Project evidence native concurrency probe passed: one append, one replay, one observation, one request."
