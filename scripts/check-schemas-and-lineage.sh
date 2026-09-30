#!/usr/bin/env bash
# One-command runner for the four scorecard schema suites, the lineage
# trace unit tests, and (optionally) the provenance visual regression suite.
#
# Mirrors the exact commands in .github/workflows/scorecard-contract.yml and
# .lovable/contributor-workflow.md so local runs match CI byte-for-byte.
#
# Usage:
#   scripts/check-schemas-and-lineage.sh              # schema + lineage (default)
#   scripts/check-schemas-and-lineage.sh --visual     # + Playwright visual suite
#   scripts/check-schemas-and-lineage.sh --update     # refresh visual baselines
#   scripts/check-schemas-and-lineage.sh --schemas    # schemas only
#   scripts/check-schemas-and-lineage.sh --lineage    # lineage only
#   scripts/check-schemas-and-lineage.sh --help
#
# Exit code is non-zero if any selected suite fails. Consistent settings:
#   CI=true                     — match GitHub Actions env
#   FORCE_COLOR=1               — readable local output
#   VITEST_MIN_THREADS=1        — deterministic ordering for fuzz seed
#   VITEST_MAX_THREADS=4        — bounded parallelism
#
# Related docs:
#   .lovable/contributor-workflow.md
#   .lovable/scorecard-contract-testing.md
#   .lovable/visual-regression-provenance.md
#   .lovable/troubleshooting-schema-and-provenance.md

set -euo pipefail

export CI="${CI:-true}"
export FORCE_COLOR="${FORCE_COLOR:-1}"
export VITEST_MIN_THREADS="${VITEST_MIN_THREADS:-1}"
export VITEST_MAX_THREADS="${VITEST_MAX_THREADS:-4}"

SCHEMA_SUITES=(
  "src/lib/__tests__/scorecardSchemas.contract.test.ts"
  "src/lib/__tests__/scorecardSchemas.fuzz.test.ts"
  "src/lib/__tests__/scorecardEndpoints.contract.test.ts"
  "src/lib/__tests__/fixtures/scorecardFixtures.test.ts"
)

LINEAGE_SUITES=(
  "src/pages/__tests__/provenanceReceiptViewer.trace.test.ts"
)

VISUAL_SPEC="tests/visual/provenance-tracing.spec.ts"

run_schemas="yes"
run_lineage="yes"
run_visual="no"
update_visual="no"

usage() {
  sed -n '2,20p' "$0"
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    --schemas) run_schemas="yes"; run_lineage="no"; run_visual="no" ;;
    --lineage) run_schemas="no"; run_lineage="yes"; run_visual="no" ;;
    --visual)  run_visual="yes" ;;
    --update)  run_visual="yes"; update_visual="yes" ;;
    --all)     run_schemas="yes"; run_lineage="yes"; run_visual="yes" ;;
    *) echo "Unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }
ok()   { printf "\n\033[1;32m✓ %s\033[0m\n" "$*"; }

if [[ "$run_schemas" == "yes" ]]; then
  step "Schema suites (contract / fuzz / endpoint / fixture self-test)"
  bun x vitest run "${SCHEMA_SUITES[@]}" || fail "Schema suites failed"
  ok "Schema suites passed"
fi

if [[ "$run_lineage" == "yes" ]]; then
  step "Lineage diagnostics (traceLineage / ProvenanceReceiptViewer)"
  bun x vitest run "${LINEAGE_SUITES[@]}" || fail "Lineage suites failed"
  ok "Lineage suites passed"
fi

if [[ "$run_visual" == "yes" ]]; then
  if [[ "$update_visual" == "yes" ]]; then
    step "Visual regression — refreshing baselines"
    bun x playwright test "$VISUAL_SPEC" --update-snapshots || fail "Visual baseline update failed"
    ok "Visual baselines updated (review the diff before committing)"
  else
    step "Visual regression — provenance-tracing UI (8 scenarios)"
    bun x playwright test "$VISUAL_SPEC" || fail "Visual regression failed (see playwright-report/)"
    ok "Visual regression passed"
  fi
fi

printf "\n\033[1;32mAll selected checks passed.\033[0m\n"
