#!/usr/bin/env bash
# Watch mode for the scorecard schema suites and lineage diagnostics.
#
# Re-runs the affected suites in vitest watch mode whenever a related file
# changes. Uses the same environment settings as
# scripts/check-schemas-and-lineage.sh so watch-mode results match CI /
# pre-PR runs byte-for-byte (no "passes on watch, fails on check:pr"
# surprises).
#
# Usage:
#   scripts/watch-schemas-and-lineage.sh              # schemas + lineage (default)
#   scripts/watch-schemas-and-lineage.sh --schemas    # schemas only
#   scripts/watch-schemas-and-lineage.sh --lineage    # lineage only
#   scripts/watch-schemas-and-lineage.sh --all        # schemas + lineage (alias)
#   scripts/watch-schemas-and-lineage.sh --help
#
# Consistent settings (identical to check-schemas-and-lineage.sh):
#   FORCE_COLOR=1               — readable local output
#   VITEST_MIN_THREADS=1        — deterministic ordering for fuzz seed
#   VITEST_MAX_THREADS=4        — bounded parallelism
#
# NOTE: CI is intentionally NOT set here. Vitest's watch mode is a local
# developer loop; setting CI=true would disable watch. The one-shot
# check:pr / check:all runners remain the source of truth for CI-parity
# verification before opening a PR.
#
# Vitest's default watch behaviour already re-runs only the test files
# whose dependency graph includes a changed file, so editing
# `scorecardSchemas.ts` re-runs the four schema suites, and editing
# `ProvenanceReceiptViewer.tsx` or `traceLineage` re-runs the lineage
# suite — without us hand-rolling a file watcher.
#
# Related docs:
#   .lovable/contributor-workflow.md
#   .lovable/scorecard-contract-testing.md
#   .lovable/troubleshooting-schema-and-provenance.md

set -euo pipefail

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

mode="both"

usage() {
  sed -n '2,32p' "$0"
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --help|-h) usage ;;
    --schemas) mode="schemas" ;;
    --lineage) mode="lineage" ;;
    --all|--both) mode="both" ;;
    *) echo "Unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done

case "$mode" in
  schemas) SUITES=("${SCHEMA_SUITES[@]}") ;;
  lineage) SUITES=("${LINEAGE_SUITES[@]}") ;;
  both)    SUITES=("${SCHEMA_SUITES[@]}" "${LINEAGE_SUITES[@]}") ;;
esac

printf "\n\033[1;36m▸ Watching %d suite(s) — vitest re-runs on dependency change\033[0m\n" "${#SUITES[@]}"
printf "  Press \033[1mh\033[0m for help, \033[1ma\033[0m to run all, \033[1mq\033[0m to quit.\n\n"

# `vitest` (no `run`) starts watch mode. Passing explicit suite paths
# scopes the watcher to just those files and their dependency graphs.
exec bunx vitest "${SUITES[@]}"
