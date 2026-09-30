#!/usr/bin/env bash
# Runs the SQL security regression suites against the project database.
#
# Suites:
#   1. supabase/tests/security_regressions.test.sql
#        RPC grants · signed-in perms · blind-review projection ·
#        judge policy shape · anon tenant isolation · script-redaction fn
#   2. supabase/tests/access_matrix.test.sql
#        Role × tenant access matrix. Structural OR-override guard: any
#        policy on entries/scores/consensus/projects/artifacts/etc. that
#        references the judge role MUST also reference a scoping predicate.
#   3. supabase/tests/rls_probes.test.sql
#        Runtime probes. Seeds two synthetic competitions + 4 entries + 4
#        users (owner, judge_A, judge_B, admin) and actually attempts the
#        reads as each role via SET ROLE + request.jwt.claims. Fails if
#        cross-tenant rows leak, if identity content bleeds into
#        v_judge_entry_blind.script_text, or if identity columns reappear
#        on the view. Skips gracefully when the shell role can't
#        SET ROLE (Lovable sandbox); runs fully in CI as postgres.
#   4. supabase/tests/project_evidence_observation_ledger.test.sql
#        Native PostgreSQL migration/catalog, feature-gate, exact-byte,
#        append/replay, RLS, append-only, and authority non-mutation checks.
#
# Preferred connection: $SUPABASE_DB_URL. Falls back to PG* env vars.
#
# Usage:
#   scripts/check-security-regressions.sh                # run all four
#   scripts/check-security-regressions.sh --matrix-only  # only access matrix
#   scripts/check-security-regressions.sh --core-only    # only core regressions
#   scripts/check-security-regressions.sh --probes-only  # only runtime probes
#   scripts/check-security-regressions.sh --ledger-only  # only evidence ledger
#   scripts/check-security-regressions.sh --help

#
# Exit codes:
#   0   all invariants held
#   1   at least one invariant regressed (see error message)
#   2   no DB access available in this shell

set -euo pipefail

CORE_SUITE="supabase/tests/security_regressions.test.sql"
MATRIX_SUITE="supabase/tests/access_matrix.test.sql"
PROBES_SUITE="supabase/tests/rls_probes.test.sql"
LEDGER_SUITE="supabase/tests/project_evidence_observation_ledger.test.sql"

RUN_CORE=1
RUN_MATRIX=1
RUN_PROBES=1
RUN_LEDGER=1

case "${1:-}" in
  --help|-h)
    sed -n '2,40p' "$0"
    exit 0
    ;;
  --matrix-only) RUN_CORE=0; RUN_PROBES=0; RUN_LEDGER=0 ;;
  --core-only)   RUN_MATRIX=0; RUN_PROBES=0; RUN_LEDGER=0 ;;
  --probes-only) RUN_CORE=0; RUN_MATRIX=0; RUN_LEDGER=0 ;;
  --ledger-only) RUN_CORE=0; RUN_MATRIX=0; RUN_PROBES=0 ;;
esac

step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }
ok()   { printf "\n\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m! %s\033[0m\n" "$*"; }

run_suite() {
  local label="$1" file="$2"
  step "$label"
  if [[ ! -f "$file" ]]; then
    fail "Missing suite file: $file"
  fi
  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file" \
      || fail "$label FAILED (see message above)"
  elif [[ -n "${PGHOST:-}" ]]; then
    psql -v ON_ERROR_STOP=1 -f "$file" \
      || fail "$label FAILED (see message above)"
  else
    warn "No SUPABASE_DB_URL and no PG* env — cannot reach the database from this shell."
    warn "In CI, set SUPABASE_DB_URL. Locally, enable 'Read database' in Cloud settings."
    exit 2
  fi
}

(( RUN_CORE   )) && run_suite "Security regressions — grants · perms · isolation" "$CORE_SUITE"
(( RUN_MATRIX )) && run_suite "Access matrix — role × tenant policy shape"        "$MATRIX_SUITE"
(( RUN_PROBES )) && run_suite "RLS probes — cross-tenant + blind-review reads"    "$PROBES_SUITE"
(( RUN_LEDGER )) && run_suite "Project evidence ledger — exact bytes + bounded append" "$LEDGER_SUITE"

ok "All security suites passed"
