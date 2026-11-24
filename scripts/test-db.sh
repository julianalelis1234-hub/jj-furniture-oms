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
# Migration 007 (Realtime): grants and policies on every EXISTING table/function must be byte-identical before and after
AUDIT="select 'grant', table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name <> 'order_live_events'
 union all select 'policy', tablename, policyname, cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies where schemaname = 'public' and tablename <> 'order_live_events'
 union all select 'fn', p.oid::regprocedure::text, coalesce(array_to_string(p.proacl, ','), ''), '' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname not in ('is_order_customer', 'emit_order_live_event', 'prune_order_live_events')
 union all select 'rls', relname, relrowsecurity::text, relforcerowsecurity::text from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'order_live_events'
 order by 1, 2, 3, 4"
BEFORE=$(psql "$PGURL/$DB" -Atc "$AUDIT")
run "$DB" supabase/migrations/007_enable_supabase_realtime.sql
AFTER=$(psql "$PGURL/$DB" -Atc "$AUDIT")
if [[ "$BEFORE" == "$AFTER" ]]; then echo "NOTICE:  ok - migration 007 adds no grant, policy, function privilege or RLS change to any existing table/function ($(echo "$BEFORE" | wc -l) entries compared)"; else echo "TEST FAILED: migration 007 changed existing authorization:"; diff <(echo "$BEFORE") <(echo "$AFTER") | head -20; exit 1; fi
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/10_realtime_live_events.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
run "$DB" supabase/migrations/008_harden_notification_outbox.sql
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/11_notification_outbox.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"
# Outbox concurrency: worker 1 holds its claim transaction open; worker 2 must skip the locked row, not block or double-claim it
psql "$PGURL/$DB" -qAt -c "insert into public.notification_outbox (id, kind, recipient_email, idempotency_key) values
  ('82000000-0000-0000-0000-000000000001','account_setup_link','w1@example.com','skip:1'),
  ('82000000-0000-0000-0000-000000000002','account_setup_link','w2@example.com','skip:2')" >/dev/null
( psql "$PGURL/$DB" -qAt -v ON_ERROR_STOP=1 > /tmp/jj_w1_$$ <<SQL
begin;
select id from public.claim_notification_outbox(1, 60, '82000000-0000-0000-0000-000000000001');
select pg_sleep(2);
commit;
SQL
) &
W1=$!
sleep 0.7
T0=$(date +%s%N)
W2=$(psql "$PGURL/$DB" -qAt -c "select string_agg(id::text, ',') from public.claim_notification_outbox(10, 60) where id::text like '82000000%'")
T1=$(date +%s%N)
wait $W1
W1OUT=$(grep -c 82000000-0000-0000-0000-000000000001 /tmp/jj_w1_$$ || true); rm -f /tmp/jj_w1_$$
MS=$(( (T1 - T0) / 1000000 ))
if [[ "$W1OUT" == "1" && "$W2" == "82000000-0000-0000-0000-000000000002" && $MS -lt 1500 ]]; then
  echo "NOTICE:  ok - concurrent claims: worker 2 skipped worker 1's locked row without waiting (${MS} ms) and nothing was claimed twice"
else
  echo "TEST FAILED: SKIP LOCKED claim (w1=$W1OUT w2=$W2 ${MS}ms)"; exit 1
fi

# 1c'. Migration 009 (confirm -> quotation -> accept + plan -> payments) on top of all that data
run "$DB" supabase/migrations/009a_payment_channel_enums.sql
run "$DB" supabase/migrations/009b_confirm_quote_pay_flow.sql 2>/dev/null
psql "$PGURL/$DB" -v ON_ERROR_STOP=1 -f supabase/tests/12_confirm_quote_pay_flow.sql 2>&1 | grep -E "ok -|FAILED|ERROR|PASSED"

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
run "$DB2" supabase/migrations/007_enable_supabase_realtime.sql
run "$DB2" supabase/migrations/007_enable_supabase_realtime.sql
run "$DB2" supabase/migrations/008_harden_notification_outbox.sql
run "$DB2" supabase/migrations/008_harden_notification_outbox.sql
run "$DB2" supabase/migrations/009a_payment_channel_enums.sql
run "$DB2" supabase/migrations/009b_confirm_quote_pay_flow.sql 2>/dev/null
run "$DB2" supabase/migrations/009b_confirm_quote_pay_flow.sql 2>/dev/null
LIVE9=$(psql "$PGURL/$DB2" -Atc "select count(*) from public.orders where status not in ('Quote Requested','Waiting for Confirmation') and (confirmed_at is null or quotation_issued_at is null)")
if [[ "$LIVE9" == "0" ]]; then echo "NOTICE:  ok - migration 009 (twice) on the live data: every confirmed-or-later order is backfilled as confirmed and quoted"; else echo "TEST FAILED: 009 backfill left $LIVE9 orders"; exit 1; fi
OB=$(psql "$PGURL/$DB2" -Atc "select count(*) from pg_constraint where conrelid = 'public.notification_outbox'::regclass and contype = 'c'")
if [[ "$OB" == "8" ]]; then echo "NOTICE:  ok - migration 008 is idempotent on the live data (8 outbox checks, no duplicates)"; else echo "TEST FAILED: 008 re-run checks=$OB"; exit 1; fi
PUB=$(psql "$PGURL/$DB2" -Atc "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_live_events'")
TRG=$(psql "$PGURL/$DB2" -Atc "select count(*) from pg_trigger where tgname like '%live_event%' and not tgisinternal")
if [[ "$PUB" == "1" && "$TRG" == "6" ]]; then echo "NOTICE:  ok - migration 007 is idempotent on the live data (published once, 6 triggers, no duplicates)"; else echo "TEST FAILED: 007 re-run: publication=$PUB triggers=$TRG"; exit 1; fi
HIST=$(psql "$PGURL/$DB2" -Atc "select count(*) filter (where pin_code_hash is not null) from public.orders")
if [[ "$HIST" == "14" ]]; then echo "NOTICE:  ok - migration 006 on the live data keeps all 14 historical PIN hashes (data untouched)"; else echo "TEST FAILED: historical PIN hashes after 006: $HIST"; exit 1; fi

# 3. Demo seed loads into the full schema; DB balances match the TS engine ---
psql "$PGURL/postgres" -qc "create database $DB3" >/dev/null
run "$DB3" supabase/tests/00_supabase_stub.sql
migrate_all "$DB3"
npx tsx scripts/seed-sql.ts | psql "$PGURL/$DB3" -q -v ON_ERROR_STOP=1 2>&1 | grep -E "ok -|FAILED|ERROR"
# 3b. The curated five-order Demo Mode dataset loads into the real schema too
psql "$PGURL/postgres" -qc "drop database if exists $DB3" >/dev/null
psql "$PGURL/postgres" -qc "create database $DB3" >/dev/null
run "$DB3" supabase/tests/00_supabase_stub.sql
migrate_all "$DB3"
npx tsx scripts/seed-sql.ts --curated | psql "$PGURL/$DB3" -q -v ON_ERROR_STOP=1 2>&1 | grep -E "ok -|FAILED|ERROR"
CUR=$(psql "$PGURL/$DB3" -Atc "select string_agg(order_code || ':' || status, ',' order by order_code) from public.orders")
if [[ "$CUR" == "JJ-2026-1001:In Production,JJ-2026-1002:Confirmed,JJ-2026-1003:Waiting for Confirmation,JJ-2026-1004:Ready for Delivery,JJ-2026-1005:Confirmed" ]]; then
  echo "NOTICE:  ok - curated demo dataset: exactly the 5 specified orders and stages load into the real schema"
else echo "TEST FAILED: curated dataset = $CUR"; exit 1; fi
