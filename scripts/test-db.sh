#!/usr/bin/env bash
# Verifies the Supabase migrations against throwaway local Postgres databases.
# Usage: PGURL=postgres://postgres:postgres@localhost:5432 scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres:postgres@localhost:5432}"
DB="jj_oms_test_$$"; DB2="jj_oms_migr_$$"; DB3="jj_oms_seed_$$"
cleanup() { for d in "$DB" "$DB2" "$DB3"; do psql "$PGURL/postgres" -qc "drop database if exists $d" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
run() { psql "$PGURL/$1" -q -v ON_ERROR_STOP=1 -f "$2"; }
migrate_all() { for m in supabase/migrations/*.sql; do run "$1" "$m"; done; }
migrate_before_005() { for m in supabase/migrations/00[1-4]*.sql; do run "$1" "$m"; done; }

# 1. Business rules, RLS and the configurator gate on a fresh database ------
psql "$PGURL/postgres" -qc "create database $DB" >/dev/null
run "$DB" supabase/tests/00_supabase_stub.sql
migrate_before_005 "$DB"   # 01/04/05 exercise the pre-005 schema; 005 is applied on top of their data below
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/01_business_rules_and_rls.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/04_configurator_gate.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/05_dual_option_engine.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"

# 1b. Concurrency: two sessions edit the same revision at once ---------------
SPEC='{"furniture_category":"Panel Door","design_variant":"Modern 4-Panel","width_cm":90,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Walnut Stain","quoted_furniture_price":9000,"quoted_delivery_fee":0}'
ORDER=$(psql "$PGURL/$DB" -Atc "insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality, pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date, furniture_category, design_variant, width_cm, height_cm, depth_cm) values ('DR-0700','S-700','C','09000000700','A','Valencia City','h','Door',1,'-','Mahogany','Natural Varnish',9000,current_date,'Panel Door','Classic 2-Panel',80,210,4.5) returning id" | head -1)
psql "$PGURL/$DB" -qAtc "select public.add_spec_revision('$ORDER','staff_draft','$SPEC'::jsonb,null,'staff')" >/dev/null
( psql "$PGURL/$DB" -qAt -v ON_ERROR_STOP=1 >/dev/null <<SQL
begin;
select public.add_spec_revision('$ORDER','revised_quote','$SPEC'::jsonb,1,'staff');
select pg_sleep(2);
commit;
SQL
) &
A=$!
sleep 0.7
B_OUT=$(psql "$PGURL/$DB" -qAt -c "select public.add_spec_revision('$ORDER','customer_proposal','{\"furniture_category\":\"Panel Door\",\"design_variant\":\"Arch-Top Single Panel\",\"width_cm\":100,\"height_cm\":210,\"depth_cm\":5,\"wood_type\":\"Mahogany\",\"color_finish\":\"Walnut Stain\"}'::jsonb,1,'customer')" 2>&1 || true)
wait $A
REVS=$(psql "$PGURL/$DB" -Atc "select string_agg(revision_number::text || ':' || revision_type, ',' order by revision_number) from public.order_specification_revisions where order_id = '$ORDER'")
if [[ "$B_OUT" == *STALE_REVISION* && "$REVS" == "1:staff_draft,2:revised_quote" ]]; then
  echo "NOTICE:  ok - concurrent edit waited on the row lock, then was rejected as stale (no duplicate/overwritten revision: $REVS)"
else
  echo "TEST FAILED: concurrency (second session: $B_OUT; revisions: $REVS)"; exit 1
fi

# 1c. Migration 005 on top of that data, then the customer email auth tests -----
run "$DB" supabase/migrations/005a_customer_role_enums.sql
run "$DB" supabase/migrations/005b_customer_email_auth.sql 2>/dev/null
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/07_customer_email_auth.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
run "$DB" supabase/migrations/006_remove_pin_customer_rls.sql
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/09_remove_pin_customer_rls.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"

# 1d. Race: two sessions open the same review link at the same moment ---------
RORDER=$(psql "$PGURL/$DB" -Atc "insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date, furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email) values ('DR-0710','S-710','C','09000000710','Purok 1, Poblacion','Valencia City','Door',1,'-','Mahogany','Natural Varnish',9000,current_date,'Panel Door','Classic 2-Panel',80,210,4.5,'race@example.com') returning id" | head -1)
psql "$PGURL/$DB" -qAtc "select public.add_spec_revision('$RORDER','staff_draft','$SPEC'::jsonb,null,'staff')" >/dev/null
HASH=$(printf 'race-token' | sha256sum | cut -d' ' -f1)
psql "$PGURL/$DB" -qAtc "select public.issue_quote_review_token('$RORDER', (select revision_id from public.order_specification_revisions where order_id = '$RORDER' and revision_number = 1), '$HASH')" >/dev/null
( psql "$PGURL/$DB" -qAt -v ON_ERROR_STOP=1 > /tmp/jj_race_a.$$ <<SQL
begin;
select public.consume_quote_review_token('$HASH') ->> 'ok';
select pg_sleep(1.5);
commit;
SQL
) &
RA=$!
sleep 0.5
RB=$(psql "$PGURL/$DB" -qAtc "select coalesce(public.consume_quote_review_token('$HASH') ->> 'ok', 'false') || ':' || coalesce(public.consume_quote_review_token('$HASH') ->> 'reason', '')" 2>&1)
wait $RA
RAOUT=$(grep -E '^(true|false)$' /tmp/jj_race_a.$$ | head -1); rm -f /tmp/jj_race_a.$$
if [[ "$RAOUT" == "true" && "$RB" == false:used ]]; then
  echo "NOTICE:  ok - concurrent consumption of one review link: exactly one session succeeds, the other waits and sees 'used'"
else
  echo "TEST FAILED: review-token race (session A: $RAOUT; session B: $RB)"; exit 1
fi

# 2. Migrations 003 + 004 against a copy of the live (pre-003) data -----------------
psql "$PGURL/postgres" -qc "create database $DB2" >/dev/null
run "$DB2" supabase/tests/00_supabase_stub.sql
run "$DB2" supabase/migrations/001_init.sql
run "$DB2" supabase/migrations/002_security_hardening.sql
run "$DB2" supabase/tests/fixtures/live_snapshot_pre003.sql
run "$DB2" supabase/migrations/003_wooden_configurator.sql
run "$DB2" supabase/migrations/003_wooden_configurator.sql   # re-running must be harmless (idempotent)
psql "$PGURL/$DB2" -v ON_ERROR_STOP=1 -f supabase/tests/03_migration_backfill.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
# then migration 004 on top of that data (twice: re-running must be harmless)
run "$DB2" supabase/migrations/004a_quote_requested_enums.sql
run "$DB2" supabase/migrations/004b_dual_option_approval_engine.sql 2>/dev/null
run "$DB2" supabase/migrations/004b_dual_option_approval_engine.sql 2>/dev/null
psql "$PGURL/$DB2" -v ON_ERROR_STOP=1 -f supabase/tests/06_migration_004_backfill.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
# then migration 005 (twice) on the same live data
run "$DB2" supabase/migrations/005a_customer_role_enums.sql
run "$DB2" supabase/migrations/005b_customer_email_auth.sql 2>/dev/null
run "$DB2" supabase/migrations/005b_customer_email_auth.sql 2>/dev/null
psql "$PGURL/$DB2" -v ON_ERROR_STOP=1 -f supabase/tests/08_migration_005_legacy.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
run "$DB2" supabase/migrations/006_remove_pin_customer_rls.sql
run "$DB2" supabase/migrations/006_remove_pin_customer_rls.sql
HIST=$(psql "$PGURL/$DB2" -Atc "select count(*) filter (where pin_code_hash is not null) from public.orders")
if [[ "$HIST" == "14" ]]; then echo "NOTICE:  ok - migration 006 on the live data keeps all 14 historical PIN hashes (data untouched)"; else echo "TEST FAILED: historical PIN hashes after 006: $HIST"; exit 1; fi

# 3. Demo seed loads into the full schema; DB balances match the TS engine ---
psql "$PGURL/postgres" -qc "create database $DB3" >/dev/null
run "$DB3" supabase/tests/00_supabase_stub.sql
migrate_all "$DB3"
npx tsx scripts/seed-sql.ts | psql "$PGURL/$DB3" -q -v ON_ERROR_STOP=1 2>&1 | grep -E "ok -|FAILED|ERROR"
