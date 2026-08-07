#!/usr/bin/env bash
# [SEAM] Run tests/sql/*.test.sql against a real PostgreSQL.
#
# ── WHY THIS IS A SEPARATE GATE ──
# The other five gates need no services, which is what makes them runnable on a clean checkout with
# an empty environment. This one needs a database, so it cannot join `npm run gates` without taking
# that property away from every contributor. It runs in CI instead, where a postgres service is one
# line of yaml — and it is the only gate that can see a plpgsql contract at all.
#
# Locally: start any PostgreSQL and set DATABASE_URL (or the usual PG* variables), then
#   npm run test:sql
# Without one it prints how to run it and exits 0. That is a deliberate local convenience and NOT
# how it behaves in CI: SQL_SEAM_REQUIRED=1 turns a missing database into a failure, and the CI
# workflow sets it — so the gate can never go quietly green because nothing ran.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
required="${SQL_SEAM_REQUIRED:-}"

if ! command -v psql >/dev/null 2>&1; then
  msg="psql not found"
  if [ -n "$required" ]; then echo "✗ [SEAM] $msg — required in this environment." >&2; exit 1; fi
  echo "— [SEAM] skipped: $msg. Install postgresql-client to run the SQL gate locally."
  exit 0
fi

# A URL wins; otherwise fall back to whatever PG* the environment already has.
psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
if [ -n "${DATABASE_URL:-}" ]; then psql_base+=(-d "$DATABASE_URL"); fi

if ! "${psql_base[@]}" -c 'SELECT 1' >/dev/null 2>&1; then
  msg="no reachable PostgreSQL (set DATABASE_URL or PGHOST/PGUSER)"
  if [ -n "$required" ]; then echo "✗ [SEAM] $msg — required in this environment." >&2; exit 1; fi
  echo "— [SEAM] skipped: $msg."
  echo "  To run it:  docker run -e POSTGRES_PASSWORD=x -p 5432:5432 -d postgres:16"
  echo "              DATABASE_URL=postgres://postgres:x@localhost:5432/postgres npm run test:sql"
  exit 0
fi

# The fixture DROPs and recreates `public`, so it must never touch a database with real data. Refuse
# anything whose name does not say it is scratch — an accidental DATABASE_URL pointing at a project
# is exactly the mistake a money repo cannot make once.
target="$("${psql_base[@]}" -t -A -c 'SELECT current_database()')"
case "$target" in
  postgres|*test*|*seam*|*scratch*|*ci*) ;;
  *)
    echo "✗ [SEAM] refusing to run against database '$target' — this fixture DROPs schema public." >&2
    echo "  Point DATABASE_URL at a scratch database (a name containing 'test', 'seam', 'ci', or 'postgres')." >&2
    exit 1 ;;
esac

failed=0
for test_file in "$here"/tests/sql/*.test.sql; do
  name="$(basename "$test_file")"
  echo ""
  echo "══ $name ══════════════════════════════════════════════"
  # Fixture first (a clean schema per file), then every migration the test needs, then the test.
  # The migrations are loaded from supabase/migrations so the file under test is the one that ships
  # — a copy inside tests/ would be a second source of truth for money.
  if ! "${psql_base[@]}" \
        -f "$here/tests/sql/fixture.sql" \
        -f "$here/supabase/migrations/allocate_bank_payment.sql" \
        -f "$test_file" 2>&1; then
    echo "✗ $name FAILED" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then exit 1; fi
echo ""
echo "✅ [SEAM] every SQL contract held."
