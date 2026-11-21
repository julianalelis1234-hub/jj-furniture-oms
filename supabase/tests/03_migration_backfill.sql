-- Runs AFTER: 001 + 002 + fixtures/live_snapshot_pre003.sql + 003.
-- Verifies the additive migration preserved every existing value and backfilled honestly.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
\set QUIET off

select pg_temp.check(count(*) = 14, 'all 14 live orders survived the migration') from public.orders;
select pg_temp.check(count(*) = 14,
  'existing wood_type, color_finish, dimensions text and prices preserved untouched')
from public.orders where wood_type is not null and color_finish is not null and dimensions <> '' and furniture_price > 0;
select pg_temp.check(count(*) = 14 and bool_and(width_cm is null and height_cm is null and depth_cm is null),
  'no dimensions invented: legacy W/H/D left NULL (free text has no recorded axis order)')
from public.orders;
select pg_temp.check(bool_and(is_legacy_incomplete), 'every pre-configurator order flagged is_legacy_incomplete')
from public.orders;
select pg_temp.check(count(*) = 14, 'one backfilled revision 1 (staff_draft) per order')
from public.order_specification_revisions where revision_number = 1 and revision_type = 'staff_draft';
select pg_temp.check(bool_and(r.legacy_dimensions_text = o.dimensions and r.quoted_furniture_price = o.furniture_price
                              and r.quoted_delivery_fee = o.delivery_fee and r.color_finish = o.color_finish),
  'revision 1 snapshots the exact legacy text, finish and quote')
from public.order_specification_revisions r join public.orders o on o.id = r.order_id;
select pg_temp.check(bool_and(current_revision = 1), 'current_revision = 1 for all') from public.orders;
select pg_temp.check(
  (select count(*) from public.orders where specs_confirmed and approved_revision_number = 1) = 12
  and (select count(*) from public.orders where not specs_confirmed and approved_revision_number is null) = 2,
  'approved_revision_number set only for the 12 already-confirmed orders');
select pg_temp.check(count(*) = 12 and bool_and(revision_id is not null and revision_number = 1),
  'existing confirmations linked to revision 1') from public.order_confirmations;
select pg_temp.check(
  (select convalidated from pg_constraint where conname = 'orders_other_wood_note'),
  'Other-wood note constraint validated (no legacy violations)');

-- legacy order can still progress: JJ-2026-0141 Confirmed -> In Production (no pending items)
update public.orders set status = 'In Production' where order_code = 'JJ-2026-0141';
select pg_temp.check(status = 'In Production', 'legacy confirmed order still flows through the gate')
from public.orders where order_code = 'JJ-2026-0141';

-- legacy order with an open review is held: JJ-2026-0143 has a pending spec question
do $$ begin
  update public.orders set status = 'In Production' where order_code = 'JJ-2026-0143';
  raise exception 'TEST FAILED: pending review should block production';
exception when others then
  if sqlerrm not like 'PENDING_REVIEW%' then raise exception 'TEST FAILED: %', sqlerrm; end if;
  raise notice 'ok - open review item blocks production for a legacy order';
end $$;

-- a legacy waiting order cannot be confirmed with unstructured dimensions
do $$ begin
  perform public.confirm_spec_revision(id, 1, 'Customer Portal PIN', 'x') from public.orders where order_code = 'DR-0148';
  raise exception 'TEST FAILED: legacy confirmation should be refused';
exception when others then
  if sqlerrm not like 'VALIDATION%structured%' then raise exception 'TEST FAILED: %', sqlerrm; end if;
  raise notice 'ok - legacy waiting order must get a structured revised quote before it can be confirmed';
end $$;

-- legacy waiting order gets a full structured spec through a revision
select public.add_spec_revision(id, 'revised_quote',
  '{"furniture_category":"Custom Piece","design_variant":"Bed Frame","width_cm":160,"height_cm":110,"depth_cm":200,"wood_type":"Gmelina","color_finish":"Natural Varnish","quoted_furniture_price":18000,"quoted_delivery_fee":800}'::jsonb,
  1, 'staff', null) from public.orders where order_code = 'DR-0148';
select pg_temp.check(not is_legacy_incomplete and current_revision = 2 and width_cm = 160 and dimensions like '160.0 × 110.0 × 200.0 cm%',
  'legacy order upgraded via revision 2; legacy flag cleared, dimensions text regenerated')
from public.orders where order_code = 'DR-0148';

select public.confirm_spec_revision(id, 2, 'Customer Portal PIN', 'x', null, null) from public.orders where order_code = 'DR-0148';
select pg_temp.check(status = 'Confirmed' and approved_revision_number = 2, 'after the structured revision the legacy order can be confirmed')
from public.orders where order_code = 'DR-0148';

\echo 'MIGRATION 003 BACKFILL TESTS PASSED'
