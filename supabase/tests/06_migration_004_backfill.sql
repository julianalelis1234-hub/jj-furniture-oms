-- Migration 004 applied on top of the live data (after 003): nothing lost,
-- every audit row linked, existing quotes dated, legacy orders still legacy.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
\set QUIET off
select pg_temp.check(count(*) = 14 and bool_and(order_origin = 'staff_intake') and bool_and(current_revision >= 1)
                     and bool_and(furniture_price is not null and paper_slip_number is not null),
  '14 live orders kept, all staff intake, prices and paper slips untouched') from public.orders;
select pg_temp.check(bool_and(quoted_at = created_at and expires_at = created_at + interval '7 days'),
  'existing shop quotes dated: quoted_at = saved time, 7-day validity')
from public.order_specification_revisions where revision_type in ('staff_draft', 'revised_quote');
select pg_temp.check(count(*) > 0 and bool_and(revision_id is not null and specification_accepted_at = confirmed_at
                     and quotation_accepted_at = confirmed_at and accepted_total_amount = accepted_furniture_price + accepted_delivery_fee),
  'existing confirmations backfilled with both acceptance timestamps and the accepted amounts')
from public.order_confirmations;
select pg_temp.check((select is_nullable from information_schema.columns where table_name = 'order_confirmations' and column_name = 'revision_id') = 'NO',
  'order_confirmations.revision_id is NOT NULL');
select pg_temp.check(count(*) filter (where is_legacy_incomplete) = count(*) filter (where width_cm is null),
  'legacy orders still flagged; no dimensions invented') from public.orders;
select pg_temp.check(bool_and(is_production_blocking = (category = 'Spec Clarification')),
  'open spec clarifications flagged as production-blocking') from public.order_exceptions_and_repairs;
\echo 'MIGRATION 004 BACKFILL TESTS PASSED'
