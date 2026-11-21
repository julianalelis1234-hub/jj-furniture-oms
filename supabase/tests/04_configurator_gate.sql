-- Configurator, specification revisions and the 6-condition production gate.
-- Runs after 01_business_rules_and_rls.sql in the same database (profiles exist).
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_fragment text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragment in sqlerrm) > 0 then raise notice 'ok - %', p_msg; return; end if;
    raise exception 'TEST FAILED: % (unexpected error: %)', p_msg, sqlerrm;
  end;
  raise exception 'TEST FAILED: % (no error raised)', p_msg;
end $$;
create or replace function pg_temp.act_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
  execute 'set role authenticated';
end $$;
\set QUIET off

-- ------------------------------------------------ structured spec rules ----
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
       pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date)
     values ('DR-0500', 'S-500', 'X', '09000000500', 'Addr', 'Valencia City', 'h', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date)$q$,
  'orders_structured_spec_required', 'new orders must carry category, design and W×H×D');

insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, delivery_fee, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm)
values ('20000000-0000-0000-0000-000000000001', 'DR-0501', 'S-501', 'Rosalinda Abellana', '09000000501', 'Purok 3, Poblacion', 'Lantapan',
  extensions.crypt('1234', extensions.gen_salt('bf')), '6-Seater Classic Dining Table', 1, 'pending', 'Gmelina', 'Natural Varnish',
  24000, 800, current_date + 14, 'Dining Table', '6-Seater Classic', 180, 76, 90);
select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'staff_draft',
  '{"furniture_category":"Dining Table","design_variant":"6-Seater Classic","width_cm":180,"height_cm":76,"depth_cm":90,"wood_type":"Gmelina","color_finish":"Natural Varnish","quoted_furniture_price":24000,"quoted_delivery_fee":800}'::jsonb,
  null, 'staff', '00000000-0000-0000-0000-000000000002');
select pg_temp.check(current_revision = 1 and dimensions = '180.0 × 76.0 × 90.0 cm (W × H × D)', 'staff draft becomes revision 1; dimensions text generated')
from public.orders where order_code = 'DR-0501';

select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote',
     '{"furniture_category":"Dining Table","design_variant":"6-Seater Classic","width_cm":0,"height_cm":76,"depth_cm":90,"wood_type":"Gmelina","color_finish":"Natural Varnish"}'::jsonb, 1, 'staff')$q$,
  'VALIDATION', 'width 0 cm rejected');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote',
     '{"furniture_category":"Dining Table","design_variant":"6-Seater Classic","width_cm":1200,"height_cm":76,"depth_cm":90,"wood_type":"Gmelina","color_finish":"Natural Varnish"}'::jsonb, 1, 'staff')$q$,
  'VALIDATION', 'width above 1000 cm rejected');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote',
     '{"furniture_category":"Dining Table","design_variant":"6-Seater Classic","width_cm":180,"height_cm":76,"depth_cm":90,"wood_type":"Other","color_finish":"Natural Varnish"}'::jsonb, 1, 'staff')$q$,
  'VALIDATION', '"Other" wood without a custom note rejected');
select pg_temp.expect_error(
  $q$update public.orders set wood_type = 'Other' where order_code = 'DR-0501'$q$,
  'orders_other_wood_note', 'direct table update to "Other" without a note rejected by constraint');

-- -------------------------------------------- Scenario 2: customer proposal ----
-- (server/service role: auth.uid() is null, as for the PIN-verified customer portal)
select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'customer_proposal',
  '{"furniture_category":"Dining Table","design_variant":"8-Seater Banquet","width_cm":220,"height_cm":76,"depth_cm":100,"wood_type":"Mahogany","color_finish":"Walnut Stain","quoted_furniture_price":1}'::jsonb,
  1, 'customer', null);
select pg_temp.check(o.current_revision = 2 and o.wood_type = 'Gmelina' and o.width_cm = 180 and o.furniture_price = 24000
                     and not o.specs_confirmed and o.approved_revision_number is null,
  'customer proposal = revision 2; authoritative spec, price and approval unchanged/locked')
from public.orders o where order_code = 'DR-0501';
select pg_temp.check(r.revision_type = 'customer_proposal' and r.quoted_furniture_price = 24000
                     and r.changed_fields -> 'wood_type' ->> 'from' = 'Gmelina' and r.changed_fields -> 'wood_type' ->> 'to' = 'Mahogany'
                     and (r.changed_fields -> 'width_cm' ->> 'to')::numeric = 220,
  'proposal records the exact field diff and cannot change the price')
from public.order_specification_revisions r join public.orders o on o.id = r.order_id
where o.order_code = 'DR-0501' and r.revision_number = 2;

select pg_temp.expect_error(
  $q$select tests.accept('20000000-0000-0000-0000-000000000001', 2, 'Customer Portal PIN', 'R. Abellana')$q$,
  'PENDING_REVIEW', 'a customer proposal cannot be confirmed before the shop quotes it');
select pg_temp.expect_error(
  $q$select tests.accept('20000000-0000-0000-0000-000000000001', 1, 'Customer Portal PIN', 'R. Abellana')$q$,
  'STALE_REVISION', 'confirming an outdated revision is rejected');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote',
     '{"furniture_category":"Dining Table","design_variant":"8-Seater Banquet","width_cm":220,"height_cm":76,"depth_cm":100,"wood_type":"Mahogany","color_finish":"Walnut Stain","quoted_furniture_price":31000,"quoted_delivery_fee":800}'::jsonb, 1, 'staff')$q$,
  'STALE_REVISION', 'editing from a stale revision is rejected (optimistic check)');

-- review item raised for the proposal
insert into public.order_exceptions_and_repairs (id, order_id, category, description, requested_by)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Spec Clarification',
  'Customer proposed: Wood Gmelina -> Mahogany; Width 180cm -> 220cm', 'Customer (portal)');

-- staff issues a revised quote (rev 3) for the proposal
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'customer_proposal',
     '{"furniture_category":"Dining Table","design_variant":"8-Seater Banquet","width_cm":220,"height_cm":76,"depth_cm":100,"wood_type":"Mahogany","color_finish":"Walnut Stain"}'::jsonb, 2, 'customer')$q$,
  'FORBIDDEN', 'staff JWT cannot forge a customer proposal');
select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote',
  '{"furniture_category":"Dining Table","design_variant":"8-Seater Banquet","width_cm":220,"height_cm":76,"depth_cm":100,"wood_type":"Mahogany","color_finish":"Walnut Stain","quoted_furniture_price":31000,"quoted_delivery_fee":800}'::jsonb,
  2, 'staff', '00000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) = 3, 'staff can read the revision history') from public.order_specification_revisions
where order_id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$select tests.accept('20000000-0000-0000-0000-000000000001', 3, 'Customer Portal PIN', 'x')$q$,
  'FORBIDDEN', 'staff cannot record a "Customer Portal PIN" confirmation');
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.check(o.current_revision = 3 and o.wood_type = 'Mahogany' and o.width_cm = 220 and o.furniture_price = 31000,
  'revised quote (rev 3) becomes the authoritative spec and price')
from public.orders o where order_code = 'DR-0501';

select pg_temp.expect_error(
  $q$select tests.accept('20000000-0000-0000-0000-000000000001', 3, 'Customer Portal PIN', 'R. Abellana')$q$,
  'PENDING_REVIEW', 'open review item blocks confirmation (condition 4)');
update public.order_exceptions_and_repairs set status = 'Resolved' where id = '30000000-0000-0000-0000-000000000001';

-- ------------------------------------------- Scenario 1: confirmation ----
select tests.accept('20000000-0000-0000-0000-000000000001', 3, 'Customer Portal PIN', 'R. Abellana', null, 'JJ-2026-0501');
select pg_temp.check(o.status = 'Confirmed' and o.specs_confirmed and o.approved_revision_number = 3 and o.order_code = 'JJ-2026-0501',
  'customer confirms the LATEST revision -> Confirmed, approved_revision_number = 3, code promoted')
from public.orders o where o.id = '20000000-0000-0000-0000-000000000001';
select pg_temp.check(c.revision_number = 3 and c.revision_id = r.revision_id and (c.confirmed_specs_snapshot ->> 'quoted_furniture_price')::numeric = 31000,
  'confirmation event linked to the exact revision id/number and its quote')
from public.order_confirmations c join public.order_specification_revisions r on r.order_id = c.order_id and r.revision_number = 3
where c.order_id = '20000000-0000-0000-0000-000000000001';

-- --------------------------------------- Scenario 3: production gate ----
select pg_temp.expect_error(
  $q$update public.orders set furniture_price = 20000 where id = '20000000-0000-0000-0000-000000000001'$q$,
  'SPEC_LOCKED', 'quote/spec cannot be edited after confirmation (change request required)');
insert into public.order_exceptions_and_repairs (id, order_id, category, description, requested_by)
values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Spec Clarification', 'Edge profile?', 'Nolito Remulta');
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '20000000-0000-0000-0000-000000000001'$q$,
  'PENDING_REVIEW', 'In Production blocked while any review item is pending');
update public.order_exceptions_and_repairs set status = 'Resolved' where id = '30000000-0000-0000-0000-000000000002';
insert into public.order_exceptions_and_repairs (order_id, category, description, requested_by)
values ('20000000-0000-0000-0000-000000000001', 'Special Delivery Terms', 'Deliver after 5pm', 'Staff');
insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, verified_by_owner_or_staff)
values ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Down Payment (30%)', 9300, 'Cash', true);
update public.orders set status = 'In Production' where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.check(status = 'In Production', 'all gates met (30% verified; non-blocking item pending is fine) -> In Production')
from public.orders where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'customer_proposal',
     '{"furniture_category":"Dining Table","design_variant":"Round Pedestal","width_cm":120,"height_cm":76,"depth_cm":120,"wood_type":"Mahogany","color_finish":"Walnut Stain"}'::jsonb, 3, 'customer')$q$,
  'SPEC_LOCKED', 'customer cannot propose changes once production started');

-- snapshot mismatch: a confirmed order whose spec no longer matches its approved revision
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, delivery_fee, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm)
values ('20000000-0000-0000-0000-000000000002', 'DR-0502', 'S-502', 'Test', '09000000502', 'Addr', 'Valencia City',
  'h', 'Door', 1, 'pending', 'Mahogany', 'Natural Varnish', 9000, 0, current_date + 14, 'Panel Door', 'Classic 2-Panel', 80, 210, 4.5);
select public.add_spec_revision('20000000-0000-0000-0000-000000000002', 'staff_draft',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quoted_furniture_price":9000,"quoted_delivery_fee":0}'::jsonb,
  null, 'staff');
select tests.accept('20000000-0000-0000-0000-000000000002', 1, 'Signed Paper Slip', 'Test');
alter table public.orders disable trigger orders_before_write;          -- simulate out-of-band tampering
update public.orders set color_finish = 'Gloss White' where id = '20000000-0000-0000-0000-000000000002';
alter table public.orders enable trigger orders_before_write;
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '20000000-0000-0000-0000-000000000002'$q$,
  'SPEC_SNAPSHOT_MISMATCH', 'production refused when the order differs from the approved revision snapshot (condition 6)');

-- ------------------------------------------------ immutability & RLS ----
select pg_temp.expect_error(
  $q$update public.order_specification_revisions set color_finish = 'Gloss White' where revision_number = 1$q$,
  'IMMUTABLE_RECORD', 'revisions are immutable');
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select pg_temp.check(count(*) = 0, 'craftsman cannot read revision rows (prices)') from public.order_specification_revisions;
select pg_temp.expect_error(
  $q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'revised_quote', '{}'::jsonb, 3, 'x')$q$,
  'FORBIDDEN', 'craftsman cannot create revisions');
select pg_temp.check(pg_get_function_result('public.workshop_orders()'::regprocedure) ~ 'width_cm'
                     and pg_get_function_result('public.workshop_orders()'::regprocedure) !~ '(price|fee|phone|address)',
  'workshop_orders() returns structured dimensions and still no money/contact columns');
select pg_temp.check(count(*) > 0 and bool_and(width_cm is not null or is_legacy_incomplete), 'craftsman sees structured workshop specs')
from public.workshop_orders();
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.act_as('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error(
  $q$select tests.accept('20000000-0000-0000-0000-000000000002', 1, 'Signed Paper Slip', 'x')$q$,
  'FORBIDDEN', 'drivers cannot record confirmations');
reset role; select set_config('request.jwt.claims', '{}', false);
set role anon;
select pg_temp.expect_error($q$select public.add_spec_revision('20000000-0000-0000-0000-000000000001', 'customer_proposal', '{}'::jsonb, 3, 'x')$q$,
  'permission denied', 'anon cannot call add_spec_revision');
select pg_temp.expect_error($q$select * from public.order_specification_revisions$q$,
  'permission denied', 'anon cannot read revisions');
reset role; select set_config('request.jwt.claims', '{}', false);

\echo 'CONFIGURATOR GATE TESTS PASSED'
