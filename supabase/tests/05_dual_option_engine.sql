-- Migration 004: dual-option ordering, quotations with expiry, atomic +
-- idempotent acceptance, the verified 30% production gate, role-checked
-- transitions and append-only audit tables.
-- Runs after 01 and 04 in the same database (profiles exist).
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
create or replace function pg_temp.rev(p_order uuid, p_num int) returns public.order_specification_revisions
language sql as $$ select * from public.order_specification_revisions where order_id = p_order and revision_number = p_num $$;
\set QUIET off

-- ------------------------------------- Option 2: customer self-service ----
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, customer_name, customer_phone, delivery_address, municipality, pin_code_hash,
       item_name, quantity, dimensions, wood_type, color_finish, status, furniture_category, design_variant, width_cm, height_cm, depth_cm)
     values ('DR-0600', 'X', '09000000600', 'Addr', 'Lantapan', 'h', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 'Waiting for Confirmation',
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5)$q$,
  'orders_quote_fields_required', 'a quotation-stage order needs a price, paper slip and completion date');
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, customer_name, customer_phone, delivery_address, municipality, pin_code_hash,
       item_name, quantity, dimensions, wood_type, color_finish, status, furniture_category, design_variant, width_cm, height_cm, depth_cm)
     values ('DR-0600', 'X', '09000000600', 'Addr', 'Lantapan', 'h', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 'Quote Requested',
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5)$q$,
  'orders_quote_requested_origin', 'Quote Requested is only for customer self-service orders');

insert into public.orders (id, order_code, customer_name, customer_phone, delivery_address, municipality, pin_code_hash,
  item_name, quantity, dimensions, wood_type, color_finish, delivery_fee, status, order_origin, client_request_key,
  furniture_category, design_variant, width_cm, height_cm, depth_cm)
values ('40000000-0000-0000-0000-000000000001', 'DR-0600', 'Josefina Lagura', '09000000600', 'Purok 5, Brgy. Bangcud, near the chapel',
  'Lantapan', extensions.crypt('2580', extensions.gen_salt('bf')), 'Classic 2-Panel Panel Door', 1, '80.0 × 210.0 × 4.5 cm (W × H × D)',
  'Gmelina', 'Natural Varnish', 0, 'Quote Requested', 'customer_self_service', 'req-key-1',
  'Panel Door', 'Classic 2-Panel', 80, 210, 4.5);
select pg_temp.check(furniture_price is null and paper_slip_number is null and estimated_completion_date is null
                     and current_revision = 1 and standard_down_payment_due = 0 and collectible_on_delivery = 0,
  'customer request saved with NULL price / paper slip / date and safe zero balances')
from public.orders where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, customer_name, customer_phone, delivery_address, municipality, pin_code_hash,
       item_name, quantity, dimensions, wood_type, color_finish, status, order_origin, client_request_key,
       furniture_category, design_variant, width_cm, height_cm, depth_cm)
     values ('DR-0601', 'X', '09000000600', 'Addr', 'Lantapan', 'h', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 'Quote Requested',
             'customer_self_service', 'req-key-1', 'Panel Door', 'Classic 2-Panel', 80, 210, 4.5)$q$,
  'orders_client_request_key_uidx', 'a double-submitted request (same idempotency key) is rejected');

select public.add_spec_revision('40000000-0000-0000-0000-000000000001', 'customer_request',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Gmelina","color_finish":"Natural Varnish","quantity":1}'::jsonb,
  null, 'customer');
select pg_temp.check(r.revision_type = 'customer_request' and r.quoted_furniture_price is null and r.quoted_at is null and r.expires_at is null,
  'revision 1 = customer_request with no price and no quotation dates')
from pg_temp.rev('40000000-0000-0000-0000-000000000001', 1) r;
select pg_temp.expect_error(
  $q$select tests.accept('40000000-0000-0000-0000-000000000001', 1, 'Customer Portal PIN', 'Josefina')$q$,
  'PENDING_REVIEW', 'a customer request cannot be accepted before the shop issues a quotation');
select pg_temp.expect_error(
  $q$update public.orders set status = 'Confirmed', specs_confirmed = true where id = '40000000-0000-0000-0000-000000000001'$q$,
  'INVALID_TRANSITION', 'Quote Requested cannot jump to Confirmed');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('40000000-0000-0000-0000-000000000001', 'customer_proposal',
     '{"furniture_category":"Panel Door","design_variant":"Modern 4-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Gmelina","color_finish":"Natural Varnish"}'::jsonb, 1, 'customer')$q$,
  'SPEC_LOCKED', 'proposals are only for issued quotations (Waiting for Confirmation)');

-- craftsmen never see intake requests
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select pg_temp.check(not exists (select 1 from public.workshop_orders() w where w.id = '40000000-0000-0000-0000-000000000001'),
  'craftsmen never see orders in Quote Requested');
reset role; select set_config('request.jwt.claims', '{}', false);

-- ------------------------------------------ staff issues the quotation ----
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(
  $q$select public.add_spec_revision('40000000-0000-0000-0000-000000000001', 'revised_quote',
     '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Gmelina","color_finish":"Natural Varnish","quoted_furniture_price":9500,"quoted_delivery_fee":600}'::jsonb,
     1, 'staff', '00000000-0000-0000-0000-000000000002')$q$,
  'paper slip', 'a quotation for a customer request needs the paper slip number');
select public.add_spec_revision('40000000-0000-0000-0000-000000000001', 'revised_quote',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Gmelina","color_finish":"Natural Varnish","quoted_furniture_price":9500,"quoted_delivery_fee":600}'::jsonb,
  1, 'staff', '00000000-0000-0000-0000-000000000002', '{}'::jsonb, 10, 'S-600', current_date + 14);
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.check(o.status = 'Waiting for Confirmation' and o.furniture_price = 9500 and o.delivery_fee = 600
                     and o.paper_slip_number = 'S-600' and o.current_revision = 2 and o.approved_revision_number is null
                     and o.standard_down_payment_due = 2850,
  'quotation issued in one transaction: revision 2, price/fee/slip on the order, status Waiting for Confirmation')
from public.orders o where o.id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check(r.revision_type = 'revised_quote' and r.quoted_at is not null
                     and r.expires_at - r.quoted_at = interval '10 days',
  'quotation validity is configurable (QUOTE_VALIDITY_DAYS = 10 here; default 7)')
from pg_temp.rev('40000000-0000-0000-0000-000000000001', 2) r;

-- --------------------------------- atomic, checked, idempotent acceptance ----
select pg_temp.expect_error(
  format($q$select public.accept_order_revision('40000000-0000-0000-0000-000000000001', %L, 1, 9500, 600, 10100, 'k1', 'Customer Portal PIN', 'J')$q$,
         (pg_temp.rev('40000000-0000-0000-0000-000000000001', 2)).revision_id),
  'STALE_REVISION', 'stale expected_revision_number is rejected (409)');
select pg_temp.expect_error(
  format($q$select public.accept_order_revision('40000000-0000-0000-0000-000000000001', %L, 2, 9000, 600, 9600, 'k1', 'Customer Portal PIN', 'J')$q$,
         (pg_temp.rev('40000000-0000-0000-0000-000000000001', 2)).revision_id),
  'AMOUNT_MISMATCH', 'accepted amounts must equal the quoted amounts');
select pg_temp.expect_error(
  format($q$select public.accept_order_revision('40000000-0000-0000-0000-000000000001', %L, 2, 9500, 600, 10100, '', 'Customer Portal PIN', 'J')$q$,
         (pg_temp.rev('40000000-0000-0000-0000-000000000001', 2)).revision_id),
  'idempotency key', 'an idempotency key is required');

-- expired quotation (backdated out-of-band by the test only)
alter table public.order_specification_revisions disable trigger spec_revisions_immutable;
update public.order_specification_revisions set quoted_at = now() - interval '9 days', expires_at = now() - interval '2 days'
where order_id = '40000000-0000-0000-0000-000000000001' and revision_number = 2;
alter table public.order_specification_revisions enable trigger spec_revisions_immutable;
select pg_temp.expect_error(
  format($q$select public.accept_order_revision('40000000-0000-0000-0000-000000000001', %L, 2, 9500, 600, 10100, 'k1', 'Customer Portal PIN', 'J')$q$,
         (pg_temp.rev('40000000-0000-0000-0000-000000000001', 2)).revision_id),
  'QUOTE_EXPIRED', 'an expired quotation cannot be accepted (410)');
select pg_temp.check(count(*) = 0, 'nothing recorded by the rejected attempts (full rollback)')
from public.order_confirmations where order_id = '40000000-0000-0000-0000-000000000001';

-- a fresh quotation (same spec and price) re-opens acceptance
select public.add_spec_revision('40000000-0000-0000-0000-000000000001', 'revised_quote',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Gmelina","color_finish":"Natural Varnish","quoted_furniture_price":9500,"quoted_delivery_fee":600}'::jsonb,
  2, 'staff');
select pg_temp.check(r.expires_at - r.quoted_at = interval '7 days', 'default validity is 7 days')
from pg_temp.rev('40000000-0000-0000-0000-000000000001', 3) r;

select public.accept_order_revision('40000000-0000-0000-0000-000000000001',
  (pg_temp.rev('40000000-0000-0000-0000-000000000001', 3)).revision_id, 3, 9500, 600, 10100,
  'accept-key-1', 'Customer Portal PIN', 'Josefina Lagura', null, 'JJ-2026-0600');
select pg_temp.check((public.accept_order_revision('40000000-0000-0000-0000-000000000001',
  (pg_temp.rev('40000000-0000-0000-0000-000000000001', 3)).revision_id, 3, 9500, 600, 10100,
  'accept-key-1', 'Customer Portal PIN', 'Josefina Lagura', null, 'JJ-2026-0600') ->> 'duplicate')::boolean,
  'replaying the same idempotency key returns the original acceptance (no duplicate)');
select pg_temp.check(count(*) = 1 and bool_and(c.revision_id = r.revision_id and c.revision_number = 3
                     and c.specification_accepted_at is not null and c.quotation_accepted_at is not null
                     and c.specification_accepted_at = c.quotation_accepted_at
                     and c.accepted_furniture_price = 9500 and c.accepted_delivery_fee = 600 and c.accepted_total_amount = 10100),
  'one acceptance row: spec + quotation timestamps and exact amounts, linked to revision_id 3')
from public.order_confirmations c, pg_temp.rev('40000000-0000-0000-0000-000000000001', 3) r
where c.order_id = '40000000-0000-0000-0000-000000000001';
select pg_temp.check(o.status = 'Confirmed' and o.specs_confirmed and o.approved_revision_number = 3 and o.order_code = 'JJ-2026-0600',
  'order Confirmed with approved_revision_number = current_revision')
from public.orders o where o.id = '40000000-0000-0000-0000-000000000001';

-- ------------------------------------------------- 30% production gate ----
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000001'$q$,
  'DOWN_PAYMENT_REQUIRED', 'Confirmed is not authorization to cut wood: 30% must be verified first');
insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, verified_by_owner_or_staff)
values ('40000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Delivery Fee', 600, 'Cash', true),
       ('40000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Down Payment (30%)', 2849.99, 'Cash', true);
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000001'$q$,
  'DOWN_PAYMENT_REQUIRED', 'delivery-fee payments and ₱0.01 short do not satisfy the furniture down payment');
insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, verified_by_owner_or_staff)
values ('40000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'Installment / Partial', 0.01, 'Cash', false);
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000001'$q$,
  'DOWN_PAYMENT_REQUIRED', 'unverified cash is not counted');
update public.payments set verified_by_owner_or_staff = true, notes = 'Handover verified'
where client_transaction_id = 'cccccccc-0000-0000-0000-000000000003';
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000001';
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.check(status = 'In Production' and remaining_furniture_balance = 6650 and collectible_on_delivery = 6650,
  'exactly 30% verified (server-summed, centavo-exact) -> In Production; balance 6,650, fee already paid')
from public.orders where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$update public.orders set delivery_fee = 900 where id = '40000000-0000-0000-0000-000000000001'$q$,
  'SPEC_LOCKED', 'quotation locked once in production');

-- owner-approved credit exception instead of the down payment
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price, delivery_fee, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, payment_exception_type)
values ('40000000-0000-0000-0000-000000000002', 'DR-0602', 'S-602', 'Credit Test', '09000000602', 'Addr 1234567890', 'Valencia City',
  'h', 'Cabinet', 1, '-', 'Mahogany', 'Walnut Stain', 15000, 0, current_date + 10,
  'Kitchen / Wall Cabinet', '2-Door Overhead', 120, 70, 35, 'Credit / Pay Later');
select public.add_spec_revision('40000000-0000-0000-0000-000000000002', 'staff_draft',
  '{"furniture_category":"Kitchen / Wall Cabinet","design_variant":"2-Door Overhead","width_cm":120,"height_cm":70,"depth_cm":35,"wood_type":"Mahogany","color_finish":"Walnut Stain","quoted_furniture_price":15000,"quoted_delivery_fee":0}'::jsonb,
  null, 'staff');
select pg_temp.check(not exists (select 1 from public.order_exceptions_and_repairs e
                                 where e.order_id = '40000000-0000-0000-0000-000000000002' and e.is_production_blocking),
  'an owner credit approval request is not production-blocking (the payment gate covers it)');
select tests.accept('40000000-0000-0000-0000-000000000002', 1, 'Signed Paper Slip', 'Credit Test');
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000002'$q$,
  'DOWN_PAYMENT_REQUIRED', 'credit terms still pending owner approval -> no production');
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(
  $q$update public.orders set payment_exception_approved = true where id = '40000000-0000-0000-0000-000000000002'$q$,
  'OWNER_ONLY', 'staff cannot approve the credit exception');
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
update public.orders set payment_exception_approved = true where id = '40000000-0000-0000-0000-000000000002';
update public.orders set status = 'In Production' where id = '40000000-0000-0000-0000-000000000002';
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.check(status = 'In Production', 'audited owner-approved credit exception unlocks production without 30%')
from public.orders where id = '40000000-0000-0000-0000-000000000002';

-- ------------------------------------------------- role-checked machine ----
select pg_temp.check(private.role_may_transition('craftsman', 'In Production', 'Completed / For Inspection')
  and not private.role_may_transition('craftsman', 'Confirmed', 'In Production')
  and not private.role_may_transition('craftsman', 'Completed / For Inspection', 'Ready for Delivery')
  and not private.role_may_transition('staff', 'Completed / For Inspection', 'Ready for Delivery')
  and private.role_may_transition('owner', 'Completed / For Inspection', 'Ready for Delivery')
  and private.role_may_transition('driver', 'Ready for Delivery', 'Out for Delivery')
  and not private.role_may_transition('driver', 'Confirmed', 'In Production'),
  'role permissions: craftsman only In Production -> For Inspection; owner-only inspection; drivers only delivery moves');
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
update public.orders set status = 'Completed / For Inspection' where id = '40000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$update public.orders set status = 'Ready for Delivery' where id = '40000000-0000-0000-0000-000000000001'$q$,
  'FORBIDDEN', 'staff cannot pass the owner inspection');
reset role; select set_config('request.jwt.claims', '{}', false);

-- --------------------------------------------- append-only audit tables ----
select pg_temp.expect_error(
  $q$update public.order_confirmations set accepted_total_amount = 1 where order_id = '40000000-0000-0000-0000-000000000001'$q$,
  'IMMUTABLE_RECORD', 'acceptance events cannot be edited');
select pg_temp.expect_error(
  $q$delete from public.order_confirmations where order_id = '40000000-0000-0000-0000-000000000001'$q$,
  'IMMUTABLE_RECORD', 'acceptance events cannot be deleted');
select pg_temp.expect_error(
  $q$delete from public.order_specification_revisions where order_id = '40000000-0000-0000-0000-000000000001'$q$,
  'IMMUTABLE_RECORD', 'revisions cannot be deleted');
select pg_temp.expect_error(
  $q$update public.payments set amount = 1 where client_transaction_id = 'cccccccc-0000-0000-0000-000000000002'$q$,
  'IMMUTABLE_RECORD', 'payment amounts cannot be edited');
select pg_temp.expect_error(
  $q$update public.payments set verified_by_owner_or_staff = false where client_transaction_id = 'cccccccc-0000-0000-0000-000000000002'$q$,
  'IMMUTABLE_RECORD', 'a verified payment cannot be un-verified');
select pg_temp.expect_error(
  $q$delete from public.payments where client_transaction_id = 'cccccccc-0000-0000-0000-000000000002'$q$,
  'IMMUTABLE_RECORD', 'payments cannot be deleted');
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(
  $q$insert into public.order_confirmations (order_id, version_number, revision_id, revision_number, confirmed_specs_snapshot,
       confirmation_method, confirmed_by_name, specification_accepted_at, quotation_accepted_at)
     select '40000000-0000-0000-0000-000000000002', 9, revision_id, 1, '{}'::jsonb, 'Signed Paper Slip', 'x', now(), now()
     from public.order_specification_revisions where order_id = '40000000-0000-0000-0000-000000000002' limit 1$q$,
  'row-level security', 'staff cannot write acceptance rows directly (only through accept_order_revision)');
reset role; select set_config('request.jwt.claims', '{}', false);

-- deleting a whole order still cascades (audit rows go with their order only)
delete from public.orders where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.check(not exists (select 1 from public.order_specification_revisions where order_id = '40000000-0000-0000-0000-000000000002')
  and not exists (select 1 from public.order_confirmations where order_id = '40000000-0000-0000-0000-000000000002'),
  'deleting an order cascades its revisions and confirmations');

set role anon;
select pg_temp.expect_error($q$select public.accept_order_revision(null, null, 1, 1, 1, 1, 'k', 'Customer Portal PIN', 'x')$q$,
  'permission denied', 'anon cannot call accept_order_revision');
reset role;

\echo 'DUAL-OPTION APPROVAL ENGINE TESTS PASSED'
