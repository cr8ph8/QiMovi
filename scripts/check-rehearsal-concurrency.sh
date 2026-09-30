#!/usr/bin/env bash
# Native PostgreSQL serialization proof. Requires a newly migrated disposable
# loopback security_regressions database with empty production data tables.
# Leaves synthetic rows and evidence logs for inspection/cluster teardown.
# Supply any local test password through PGPASSWORD, never the guarded URL.
set -euo pipefail
# Preserve the caller streams: an EXIT trap raised inside redirected db()
# otherwise inherits setup log redirects and hides/repeats its diagnostics.
exec 3>&1 4>&2

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SQL="supabase/tests/rehearsal_concurrency_setup.sql"
CALL_SQL="supabase/tests/rehearsal_concurrency_call.sql"
PROJECT_ID="97000000-0000-4000-8000-000000000003"
RUN_PREFIX="rehearsal-race-$$-$RANDOM"
LOCAL_URL_PATTERN='^postgres(ql)?://([A-Za-z0-9_-]+@)?(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/security_regressions$'
HOLDER_PID=""
HOLDER_DB_PID=""
HOLDER_APP=""
HOLDER_FD_OPEN=0
CHILD_PIDS=()

cd "$ROOT_DIR"
if [[ "${REHEARSAL_CONCURRENCY_DISPOSABLE:-}" != "1" ]]; then
  echo "Set REHEARSAL_CONCURRENCY_DISPOSABLE=1 only for a dedicated disposable database." >&2
  exit 2
fi
if [[ -z "${SECURITY_TEST_DB_URL:-}" || ! "$SECURITY_TEST_DB_URL" =~ $LOCAL_URL_PATTERN ]]; then
  echo "SECURITY_TEST_DB_URL must select loopback security_regressions without password/query options." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then echo "psql is required." >&2; exit 2; fi

db() { PGCONNECT_TIMEOUT=3 psql "$SECURITY_TEST_DB_URL" -X -qAt -v ON_ERROR_STOP=1 "$@"; }
if [[ "$(db -c 'SELECT current_database()')" != "security_regressions" ]]; then
  echo "Refusing unexpected database." >&2; exit 2
fi
if [[ "$(db -c "SELECT rolsuper FROM pg_roles WHERE rolname=current_user")" != "t" ]]; then
  echo "Disposable test superuser required for SET ROLE and backend-lock inspection." >&2; exit 2
fi
if [[ -n "${REHEARSAL_CONCURRENCY_RESULTS_DIR:-}" ]]; then
  if [[ "$REHEARSAL_CONCURRENCY_RESULTS_DIR" != /* ]]; then echo "Results directory must be absolute." >&2; exit 2; fi
  mkdir "$REHEARSAL_CONCURRENCY_RESULTS_DIR"
  RESULT_DIR="$REHEARSAL_CONCURRENCY_RESULTS_DIR"
else
  RESULT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qicsw-rehearsal-native.XXXXXX")"
fi
printf 'scenario|observed_at|pid|application_name|state|wait_event_type|wait_event|blocking_pids\n' >"$RESULT_DIR/session-observations.tsv"

cleanup() {
  local status=$?
  exec 1>&3 2>&4
  set +e
  if [[ "$HOLDER_FD_OPEN" == "1" ]]; then
    printf 'ROLLBACK;\n\\quit\n' >&9 2>/dev/null
    exec 9>&-
  fi
  db -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE '$RUN_PREFIX-%' AND pid<>pg_backend_pid()" >/dev/null 2>&1
  # Bash 3.2 treats an empty indexed array as unset under nounset. The guarded
  # expansion preserves each populated element while producing none when empty.
  for child in ${CHILD_PIDS[@]+"${CHILD_PIDS[@]}"}; do
    # A previously reaped PID could be recycled. Signal only this shell's
    # still-running jobs, never an arbitrary process with an old numeric PID.
    if jobs -pr | grep -qx "$child"; then kill "$child" >/dev/null 2>&1 || true; fi
    wait "$child" >/dev/null 2>&1 || true
  done
  echo "Native rehearsal evidence: $RESULT_DIR"
  if (( status != 0 )); then
    echo "Native rehearsal concurrency failed (exit $status). Synthetic database retained for inspection." >&2
    for error_file in "$RESULT_DIR"/*.err; do [[ -f "$error_file" ]] && sed -n '1,60p' "$error_file" >&2; done
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_sql() {
  local expected="$1" query="$2" label="$3" observed=""
  for ((attempt=0; attempt<200; attempt++)); do
    observed="$(db -c "$query")"
    if [[ "$observed" == "$expected" ]]; then return 0; fi
    sleep 0.05
  done
  echo "Timed out waiting for $label; expected=$expected observed=${observed:-unknown}." >&2
  return 1
}

capture_activity() {
  local scenario="$1"
  db -F '|' -c "SELECT '$scenario',clock_timestamp(),pid,application_name,state,wait_event_type,wait_event,pg_blocking_pids(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE '$RUN_PREFIX-%' ORDER BY application_name" >>"$RESULT_DIR/session-observations.tsv"
}

start_held() {
  local scenario="$1" kind="$2" case_key="$3"
  HOLDER_APP="$RUN_PREFIX-$scenario-holder"
  local fifo="$RESULT_DIR/$scenario.fifo"
  mkfifo "$fifo"
  PGAPPNAME="$HOLDER_APP" PGCONNECT_TIMEOUT=3 psql "$SECURITY_TEST_DB_URL" -X -qAt -F '|' -v ON_ERROR_STOP=1 \
    <"$fifo" >"$RESULT_DIR/$scenario-holder.out" 2>"$RESULT_DIR/$scenario-holder.err" &
  HOLDER_PID=$!
  CHILD_PIDS+=("$HOLDER_PID")
  exec 9>"$fifo"
  HOLDER_FD_OPEN=1
  printf "BEGIN;\nSET idle_in_transaction_session_timeout='30s';\n" >&9
  if [[ "$kind" == "block" ]]; then
    printf "SELECT 1 FROM public.projects WHERE id='$PROJECT_ID'::uuid FOR UPDATE;\n" >&9
  else
    printf '\\set is_pack %s\n\\set case_key %s\n\\i %s\n' "$kind" "$case_key" "$CALL_SQL" >&9
  fi
  printf '\\echo REHEARSAL_HELD_READY\n' >&9
  for ((attempt=0; attempt<200; attempt++)); do
    if grep -q '^REHEARSAL_HELD_READY$' "$RESULT_DIR/$scenario-holder.out"; then break; fi
    if ! kill -0 "$HOLDER_PID" 2>/dev/null; then echo "Holder failed before readiness: $scenario" >&2; return 1; fi
    sleep 0.05
  done
  if ! grep -q '^REHEARSAL_HELD_READY$' "$RESULT_DIR/$scenario-holder.out"; then echo "Holder readiness timeout: $scenario" >&2; return 1; fi
  wait_sql 1 "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='$HOLDER_APP' AND state='idle in transaction'" "held transaction $scenario"
  HOLDER_DB_PID="$(db -c "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='$HOLDER_APP'")"
  [[ "$HOLDER_DB_PID" =~ ^[0-9]+$ ]] || { echo "Missing held backend PID." >&2; return 1; }
}

launch_racer() {
  local scenario="$1" suffix="$2" is_pack="$3" case_key="$4"
  LAST_APP="$RUN_PREFIX-$scenario-$suffix"
  PGAPPNAME="$LAST_APP" PGCONNECT_TIMEOUT=3 psql "$SECURITY_TEST_DB_URL" -X -qAt -F '|' -v ON_ERROR_STOP=1 \
    -v is_pack="$is_pack" -v case_key="$case_key" -f "$CALL_SQL" \
    >"$RESULT_DIR/$scenario-$suffix.out" 2>"$RESULT_DIR/$scenario-$suffix.err" &
  LAST_PID=$!
  CHILD_PIDS+=("$LAST_PID")
}

wait_blocked() {
  local scenario="$1" expected="$2" apps="$3"
  # A second waiter can queue behind the first waiter rather than directly
  # behind the holder. Follow PostgreSQL's actual blocker chain to its root.
  wait_sql "$expected" "WITH RECURSIVE chain(origin,pid) AS (
    SELECT pid,pid FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ($apps) AND wait_event_type='Lock'
    UNION SELECT c.origin,b.pid FROM chain c CROSS JOIN LATERAL unnest(pg_blocking_pids(c.pid)) b(pid)
  ) SELECT count(DISTINCT origin) FROM chain WHERE pid=$HOLDER_DB_PID" "independent RPC sessions blocked by the held project transaction ($scenario)"
  capture_activity "$scenario"
}

release_held() {
  printf 'COMMIT;\n\\quit\n' >&9
  exec 9>&-
  HOLDER_FD_OPEN=0
  wait "$HOLDER_PID"
  HOLDER_PID=""
  HOLDER_DB_PID=""
}

wait_racer() {
  if wait "$1"; then LAST_STATUS=0; else LAST_STATUS=$?; fi
}

assert_state() { db -c "SELECT rehearsal_concurrency_test.assert_state($1,$2)" | tee -a "$RESULT_DIR/state-assertions.out"; }
assert_one_row() { [[ "$(wc -l <"$1" | tr -d ' ')" == "1" ]] || { echo "Expected one result row in $1" >&2; return 1; }; }
assert_held_row() { awk -F '|' -v version="$2" -v state="$3" 'NF==5 {rows++; if($2==version && $4=="f" && $5==state) good++} END {exit !(rows==1 && good==1)}' "$1"; }
assert_result_hash() {
  local result_file="$1" kind="$2" case_key="$3" expected_hash=""
  if [[ "$kind" == "draft" ]]; then
    expected_hash="$(db -c "SELECT draft_sha256 FROM rehearsal_concurrency_test.draft_calls WHERE case_key='$case_key'")"
  else
    expected_hash="$(db -c "SELECT pack_sha256 FROM rehearsal_concurrency_test.pack_calls WHERE case_key='$case_key'")"
  fi
  [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || { echo "Fixture hash is missing for $case_key." >&2; return 1; }
  awk -F '|' -v expected="$expected_hash" 'NF==5 {rows++; if($3==expected) matches++} END {exit !(rows==1 && matches==1)}' "$result_file"
}

db -c "SELECT version(),current_database(),inet_server_addr(),inet_server_port()" >"$RESULT_DIR/environment.out"
db -f "$SETUP_SQL" >"$RESULT_DIR/setup.out" 2>"$RESULT_DIR/setup.err"
assert_state 1 1

# 1. Competing proposals share an expected head. Both are observed waiting
# before the lock is released; only one may append version two.
start_held competing block unused
launch_racer competing a false competing_a; A_PID="$LAST_PID"; A_APP="$LAST_APP"
launch_racer competing b false competing_b; B_PID="$LAST_PID"; B_APP="$LAST_APP"
wait_blocked competing 2 "'$A_APP','$B_APP'"
release_held
wait_racer "$A_PID"; A_STATUS="$LAST_STATUS"
wait_racer "$B_PID"; B_STATUS="$LAST_STATUS"
if ! { (( A_STATUS==0 && B_STATUS!=0 )) || (( A_STATUS!=0 && B_STATUS==0 )); }; then
  echo "Competing proposals expected one success and one conflict; A=$A_STATUS B=$B_STATUS" >&2; exit 1
fi
if (( A_STATUS==0 )); then WINNER=a; LOSER=b; else WINNER=b; LOSER=a; fi
assert_one_row "$RESULT_DIR/competing-$WINNER.out"
assert_result_hash "$RESULT_DIR/competing-$WINNER.out" draft "competing_$WINNER"
grep -q 'rehearsal_draft_current_conflict' "$RESULT_DIR/competing-$LOSER.err"
[[ ! -s "$RESULT_DIR/competing-$LOSER.out" ]] || { echo "Conflicted writer emitted an unexpected result." >&2; exit 1; }
awk -F '|' '$2==2 && $4=="f" && $5=="CURRENT_PACK" {ok=1} END {exit !ok}' "$RESULT_DIR/competing-$WINNER.out"
assert_state 2 1
echo "PASS competing proposals: two blocked RPC sessions, one append, one current-head conflict." | tee -a "$RESULT_DIR/summary.out"

# 2. Same proposal bytes share the new expected head: one append plus replay.
db -c "SELECT rehearsal_concurrency_test.prepare_draft('same_proposal',first_pack_id,'97000000-0000-4000-8000-000000000013') FROM rehearsal_concurrency_test.fixture" >/dev/null
start_held idempotent block unused
launch_racer idempotent a false same_proposal; A_PID="$LAST_PID"; A_APP="$LAST_APP"
launch_racer idempotent b false same_proposal; B_PID="$LAST_PID"; B_APP="$LAST_APP"
wait_blocked idempotent 2 "'$A_APP','$B_APP'"
release_held
wait_racer "$A_PID"; A_STATUS="$LAST_STATUS"
wait_racer "$B_PID"; B_STATUS="$LAST_STATUS"
[[ "$A_STATUS|$B_STATUS" == "0|0" ]] || { echo "Idempotent racers failed." >&2; exit 1; }
assert_one_row "$RESULT_DIR/idempotent-a.out"; assert_one_row "$RESULT_DIR/idempotent-b.out"
assert_result_hash "$RESULT_DIR/idempotent-a.out" draft same_proposal
assert_result_hash "$RESULT_DIR/idempotent-b.out" draft same_proposal
[[ "$(cut -d '|' -f 1 "$RESULT_DIR/idempotent-a.out")" == "$(cut -d '|' -f 1 "$RESULT_DIR/idempotent-b.out")" ]] || { echo "Idempotent race returned different draft IDs." >&2; exit 1; }
awk -F '|' '$2==3 && $5=="CURRENT_PACK" && $4=="f" {writes++} $2==3 && $5=="CURRENT_PACK" && $4=="t" {replays++} END {exit !(writes==1 && replays==1)}' "$RESULT_DIR/idempotent-a.out" "$RESULT_DIR/idempotent-b.out"
assert_state 3 1
echo "PASS same proposal: two blocked RPC sessions, one exact record and one replay." | tee -a "$RESULT_DIR/summary.out"

# 3. Pack replacement actually executes first and holds its project lock.
# The stale save must wait, then see the committed replacement and append zero.
db -c "SELECT rehearsal_concurrency_test.prepare_pack('replacement_before_save',first_pack_id,'97000000-0000-4000-8000-000000000021'),rehearsal_concurrency_test.prepare_draft('stale_after_pack',first_pack_id,'97000000-0000-4000-8000-000000000014') FROM rehearsal_concurrency_test.fixture" >/dev/null
start_held pack_first true replacement_before_save
assert_held_row "$RESULT_DIR/pack_first-holder.out" 2 PACK_REPLACED
assert_result_hash "$RESULT_DIR/pack_first-holder.out" pack replacement_before_save
launch_racer pack_first stale false stale_after_pack; A_PID="$LAST_PID"; A_APP="$LAST_APP"
wait_blocked pack_first 1 "'$A_APP'"
assert_state 3 1
release_held
wait_racer "$A_PID"; A_STATUS="$LAST_STATUS"
(( A_STATUS!=0 )) || { echo "Stale save unexpectedly succeeded." >&2; exit 1; }
grep -q 'rehearsal_draft_stale_pack_basis' "$RESULT_DIR/pack_first-stale.err"
[[ ! -s "$RESULT_DIR/pack_first-stale.out" ]] || { echo "Stale writer emitted an unexpected result." >&2; exit 1; }
assert_state 3 2
echo "PASS pack replacement first: authenticated save waited, then rejected the stale basis with zero append." | tee -a "$RESULT_DIR/summary.out"

# 4. A valid save executes first and holds the same project lock. Replacement
# waits, then commits after the save; an owner read reports the exact draft as
# historical SUPERSEDED_PACK rather than silently applying/rebinding it.
db -c "SELECT rehearsal_concurrency_test.prepare_draft('save_before_pack',a.id,'97000000-0000-4000-8000-000000000015'),rehearsal_concurrency_test.prepare_pack('replacement_after_save',a.id,'97000000-0000-4000-8000-000000000022') FROM public.project_artifacts a WHERE a.project_id='$PROJECT_ID'::uuid AND a.artifact_type='preproduction_pack' AND a.is_current" >/dev/null
start_held save_first false save_before_pack
assert_held_row "$RESULT_DIR/save_first-holder.out" 4 CURRENT_PACK
assert_result_hash "$RESULT_DIR/save_first-holder.out" draft save_before_pack
launch_racer save_first replacement true replacement_after_save; A_PID="$LAST_PID"; A_APP="$LAST_APP"
wait_blocked save_first 1 "'$A_APP'"
assert_state 3 2
release_held
wait_racer "$A_PID"; A_STATUS="$LAST_STATUS"
[[ "$A_STATUS" == "0" ]] || { echo "Replacement after save failed." >&2; exit 1; }
assert_one_row "$RESULT_DIR/save_first-replacement.out"
assert_result_hash "$RESULT_DIR/save_first-replacement.out" pack replacement_after_save
assert_held_row "$RESULT_DIR/save_first-holder.out" 4 CURRENT_PACK
db -F '|' >"$RESULT_DIR/final-owner-read.out" <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false) AS ignored_role \gset
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',owner_id)::text,false) AS ignored_claims FROM rehearsal_concurrency_test.fixture \gset
SELECT r.draft_id,r.version,r.draft_sha256,r.replayed,r.basis_state FROM rehearsal_concurrency_test.fixture f
CROSS JOIN LATERAL public.read_rehearsal_draft_v1(f.project_id,f.entry_id) r;
SQL
assert_one_row "$RESULT_DIR/final-owner-read.out"
assert_result_hash "$RESULT_DIR/final-owner-read.out" draft save_before_pack
SAVED_ID="$(awk -F '|' '$2==4 && $5=="CURRENT_PACK" {print $1}' "$RESULT_DIR/save_first-holder.out")"
[[ "$SAVED_ID" == "$(cut -d '|' -f 1 "$RESULT_DIR/final-owner-read.out")" ]] || { echo "Historical owner read changed saved draft identity." >&2; exit 1; }
awk -F '|' '$2==4 && $4=="f" && $5=="SUPERSEDED_PACK" {ok=1} END {exit !ok}' "$RESULT_DIR/final-owner-read.out"
assert_state 4 3
echo "PASS rehearsal save first: replacement waited; exact saved draft reopened as SUPERSEDED_PACK." | tee -a "$RESULT_DIR/summary.out"

SESSION_COUNT="$(awk -F '|' 'NR>1 {seen[$3]=1} END {for(pid in seen)n++; print n+0}' "$RESULT_DIR/session-observations.tsv")"
[[ "$SESSION_COUNT" == "10" ]] || { echo "Expected ten distinct held/writer PostgreSQL backends, observed $SESSION_COUNT." >&2; exit 1; }
echo "Native PostgreSQL rehearsal concurrency: 4 scenarios passed across $SESSION_COUNT independent held/writer backends; final 4 drafts and 3 intentional fixture pack versions. Exact history preserved; modeled production, evidence and cash fixture tables unchanged." | tee -a "$RESULT_DIR/summary.out"
