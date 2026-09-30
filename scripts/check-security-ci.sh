#!/usr/bin/env bash
# Rebuilds the focused PR1 security schema and runs every SQL security suite.
# The harness accepts only loopback URLs and independently verifies the
# `security_regressions` database name before the fixture resets any schema.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="supabase/tests/fixtures/security_baseline.sql"
MANIFEST="supabase/tests/fixtures/security_migrations.txt"
SUPERSEDED_MANIFEST="supabase/tests/fixtures/security_migrations_superseded.txt"

cd "$ROOT_DIR"

if [[ -z "${SECURITY_TEST_DB_URL:-}" ]]; then
  echo "SECURITY_TEST_DB_URL is required (use a local database named security_regressions)." >&2
  exit 2
fi

LOCAL_DATABASE_URL_PATTERN='^postgres(ql)?://([^/@]+@)?(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/security_regressions$'
if [[ ! "$SECURITY_TEST_DB_URL" =~ $LOCAL_DATABASE_URL_PATTERN ]]; then
  echo "SECURITY_TEST_DB_URL must use a loopback host and the security_regressions database." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run the security CI fixture." >&2
  exit 2
fi

ACTUAL_DATABASE="$(psql "$SECURITY_TEST_DB_URL" -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database()')"
if [[ "$ACTUAL_DATABASE" != "security_regressions" ]]; then
  echo "Connected to unexpected database: $ACTUAL_DATABASE" >&2
  exit 2
fi

# Native rehearsal fixtures intentionally retain append-only history. Require a
# fresh disposable database on another run, before resetting any schema.
if [[ "$(psql "$SECURITY_TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT to_regnamespace('rehearsal_concurrency_test') IS NOT NULL")" == "t" ]]; then
  echo "Rehearsal fixture already exists; recreate the dedicated disposable database before running security CI again." >&2
  exit 2
fi

# Fail closed when the migration history advances. Every migration in the
# focused containment era must be either replayed by this harness or explicitly
# documented as superseded by a later replayed migration.
FIRST_MANAGED_MIGRATION="$({
  sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$MANIFEST"
  sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$SUPERSEDED_MANIFEST"
} | LC_ALL=C sort | head -n 1)"

if [[ -z "$FIRST_MANAGED_MIGRATION" ]]; then
  echo "Security migration manifests are empty." >&2
  exit 1
fi

DUPLICATE_DECLARATION="$({
  sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$MANIFEST"
  sed -e '/^[[:space:]]*#/d' -e '/^[[:space:]]*$/d' "$SUPERSEDED_MANIFEST"
} | LC_ALL=C sort | uniq -d | head -n 1)"

if [[ -n "$DUPLICATE_DECLARATION" ]]; then
  echo "Security migration is declared more than once: $DUPLICATE_DECLARATION" >&2
  exit 1
fi

while IFS= read -r migration; do
  [[ "$migration" < "$FIRST_MANAGED_MIGRATION" ]] && continue
  if ! grep -Fqx "$migration" "$MANIFEST" \
     && ! grep -Fqx "$migration" "$SUPERSEDED_MANIFEST"; then
    echo "Unclassified containment-era migration: $migration" >&2
    echo "Add it to $MANIFEST or document why it is superseded in $SUPERSEDED_MANIFEST." >&2
    exit 1
  fi
done < <(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print | LC_ALL=C sort)

psql "$SECURITY_TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$FIXTURE"

while IFS= read -r migration || [[ -n "$migration" ]]; do
  migration="${migration%$'\r'}"
  [[ -z "$migration" || "$migration" == \#* ]] && continue

  if [[ "$migration" != supabase/migrations/*.sql || "$migration" == *".."* ]]; then
    echo "Invalid security migration path in $MANIFEST: $migration" >&2
    exit 1
  fi
  if [[ ! -f "$migration" ]]; then
    echo "Missing security migration from $MANIFEST: $migration" >&2
    exit 1
  fi

  psql "$SECURITY_TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$migration"
done < "$MANIFEST"

export SUPABASE_DB_URL="$SECURITY_TEST_DB_URL"
bash scripts/check-security-regressions.sh
bash scripts/check-project-evidence-concurrency.sh
# This script has just rebuilt the dedicated loopback fixture. The rehearsal
# probe additionally verifies empty data tables before seeding its own rows.
REHEARSAL_CONCURRENCY_DISPOSABLE=1 bash scripts/check-rehearsal-concurrency.sh
