#!/usr/bin/env bash
# Verifies supabase/migrations/001_init.sql against a throwaway local Postgres DB.
# Usage: PGURL=postgres://postgres@localhost:5432 scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres:postgres@localhost:5432}"
DB="jj_oms_test_$$"
psql "$PGURL/postgres" -qc "create database $DB" >/dev/null
trap 'psql "$PGURL/postgres" -qc "drop database if exists $DB" >/dev/null' EXIT
psql "$PGURL/$DB" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
psql "$PGURL/$DB" -q -v ON_ERROR_STOP=1 -f supabase/migrations/001_init.sql
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/01_business_rules_and_rls.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"

# Seed cross-check on a second fresh database
DB2="jj_oms_seed_$$"
psql "$PGURL/postgres" -qc "create database $DB2" >/dev/null
trap 'psql "$PGURL/postgres" -qc "drop database if exists $DB" >/dev/null; psql "$PGURL/postgres" -qc "drop database if exists $DB2" >/dev/null' EXIT
psql "$PGURL/$DB2" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
psql "$PGURL/$DB2" -q -v ON_ERROR_STOP=1 -f supabase/migrations/001_init.sql
npx tsx scripts/seed-sql.ts | psql "$PGURL/$DB2" -q -v ON_ERROR_STOP=1 2>&1 | grep -E "ok -|FAILED|ERROR"
