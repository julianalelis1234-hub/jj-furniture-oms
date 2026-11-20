-- Business-rule and RLS assertions for 001_init.sql.
-- Run: scripts/test-db.sh   (each failure raises and aborts with ON_ERROR_STOP)
\set ON_ERROR_STOP on
\set QUIET on

-- --------------------------------------------------------------- fixtures --
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'), -- owner
  ('00000000-0000-0000-0000-000000000002'), -- staff
  ('00000000-0000-0000-0000-000000000003'), -- craftsman
  ('00000000-0000-0000-0000-000000000004'), -- driver (assigned)
  ('00000000-0000-0000-0000-000000000005'); -- driver (other)

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-000000000001', 'Mr. Vincris Lelis', 'owner'),
  ('00000000-0000-0000-0000-000000000002', 'Gilbert Decena', 'staff'),
  ('00000000-0000-0000-0000-000000000003', 'Nolito Remulta', 'craftsman'),
  ('00000000-0000-0000-0000-000000000004', 'Jesse Decena', 'driver'),
  ('00000000-0000-0000-0000-000000000005', 'Rey', 'driver');

create or replace function pg_temp.act_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
  execute 'set role authenticated';
end $$;

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

\set QUIET off
-- -------------------------------------------------- financial engine -------
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address,
  municipality, pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price,
  delivery_fee, estimated_completion_date)
values
  ('10000000-0000-0000-0000-000000000001', 'JJ-2026-0145', 'SLIP-1001', 'Maria Santos', '09000000101',
   'Purok 3, Poblacion', 'Valencia City', extensions.crypt('4821', extensions.gen_salt('bf')),
   'Dining Table', 1, '210cm x 90cm x 4.5cm', 'Mahogany', 'Dark Walnut Gloss', 28500, 500, current_date + 10),
  ('10000000-0000-0000-0000-000000000002', 'JJ-2026-0136', 'SLIP-1002', 'Pedro Bautista', '09000000103',
   'Sitio Kibalabag', 'Lantapan', extensions.crypt('1111', extensions.gen_salt('bf')),
   'Sala Set', 1, '3-seater 200cm', 'Gmelina', 'Natural Matte', 45000, 1200, current_date + 5);

select pg_temp.check(delivery_fee = 0 and standard_down_payment_due = 8550 and remaining_furniture_balance = 28500
                     and collectible_on_delivery = 28500,
  'Valencia City forces ₱0 delivery fee; 30% down payment due = 8,550')
from public.orders where order_code = 'JJ-2026-0145';

select pg_temp.check(delivery_fee = 1200 and collectible_on_delivery = 46200,
  'provincial (Lantapan) keeps distance fee; collectible = balance + fee')
from public.orders where order_code = 'JJ-2026-0136';

insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, verified_by_owner_or_staff)
values ('10000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Down Payment (30%)', 13500, 'Cash', true);

select pg_temp.check(remaining_furniture_balance = 31500 and collectible_on_delivery = 32700 and version = 2,
  'verified 30% payment leaves 70% balance (31,500) + fee = 32,700; version bumped')
from public.orders where order_code = 'JJ-2026-0136';

insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method)
values ('10000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Delivery Balance Collection', 5000, 'Cash');
select pg_temp.check(remaining_furniture_balance = 31500,
  'unverified driver cash does not reduce the balance until handover is verified')
from public.orders where order_code = 'JJ-2026-0136';

select pg_temp.expect_error(
  $q$insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method)
     values ('10000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Delivery Fee', -5, 'Cash')$q$,
  'payments_amount_check', 'negative payment amounts are rejected');

select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address,
       municipality, pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price,
       estimated_completion_date)
     values ('JJ-2026-0999', 'SLIP-1001', 'X', '0917', 'Y', 'Valencia City', 'h', 'Chair', 1, '1x1', 'Other', 'Red', 100, current_date)$q$,
  'orders_paper_slip_number_key', 'duplicate paper slip numbers are rejected');

select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address,
       municipality, pin_code_hash, item_name, quantity, dimensions, wood_type, color_finish, furniture_price,
       estimated_completion_date)
     values ('JJ-2026-0998', 'SLIP-X', 'X', '0917', 'Y', 'Valencia City', 'h', 'Chair', 1, '1x1', 'Other', 'Red', -100, current_date)$q$,
  'orders_furniture_price_check', 'negative furniture price is rejected');

-- ------------------------------------------------------ state machine ------
select pg_temp.expect_error(
  $q$update public.orders set status = 'Confirmed' where order_code = 'JJ-2026-0145'$q$,
  'SPECS_NOT_CONFIRMED', 'cannot confirm before customer confirms specs');
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production', specs_confirmed = false where order_code = 'JJ-2026-0145'$q$,
  'INVALID_TRANSITION', 'cannot skip from Waiting straight to In Production');

update public.orders set specs_confirmed = true, status = 'Confirmed' where order_code = 'JJ-2026-0145';
update public.orders set status = 'In Production' where order_code = 'JJ-2026-0145';
update public.orders set status = 'Completed / For Inspection' where order_code = 'JJ-2026-0145';
update public.orders set status = 'Ready for Delivery' where order_code = 'JJ-2026-0145';
select pg_temp.check(status = 'Ready for Delivery', 'valid forward progression through stages 1-5')
from public.orders where order_code = 'JJ-2026-0145';

select pg_temp.expect_error(
  $q$update public.orders set status = 'Out for Delivery' where order_code = 'JJ-2026-0145'$q$,
  'DOWN_PAYMENT_REQUIRED', 'dispatch blocked without 30% down payment or owner exception');

insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, verified_by_owner_or_staff)
values ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Down Payment (30%)', 8550, 'GCash / Bank Transfer', true);
update public.orders set status = 'Out for Delivery' where order_code = 'JJ-2026-0145';
update public.orders set status = 'Delivered' where order_code = 'JJ-2026-0145';
select pg_temp.expect_error(
  $q$update public.orders set status = 'In Production' where order_code = 'JJ-2026-0145'$q$,
  'INVALID_TRANSITION', 'Delivered is terminal');

select pg_temp.expect_error(
  $q$insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method)
     values ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Delivery Fee', 1, 'Cash')$q$,
  'payments_client_transaction_id_key', 'duplicate client_transaction_id is rejected (offline idempotency)');

-- --------------------------------------------------- exception gate --------
update public.orders set payment_exception_type = 'Installment' where order_code = 'JJ-2026-0136';
select pg_temp.check(count(*) = 1, 'Installment terms auto-create a Pending owner approval')
from public.order_exceptions_and_repairs
where order_id = '10000000-0000-0000-0000-000000000002' and category = 'Installment Approval' and status = 'Pending';

-- ----------------------------------------------------------- delivery -----
insert into public.delivery_assignments (order_id, driver_id, vehicle_type, scheduled_date, time_window, delivery_fee, expected_collectible_amount)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'Elf Truck', current_date, '9:00 AM - 11:00 AM', 1200, 32700);

-- ------------------------------------------------------------------ RLS ----
-- anon: no table access and no direct RPC access (server-only since 002)
set role anon;
select pg_temp.expect_error($q$select * from public.orders$q$, 'permission denied', 'anon cannot read orders table');
select pg_temp.expect_error($q$select public.customer_track('JJ-2026-0136')$q$, 'permission denied', 'anon cannot call customer_track directly');
select pg_temp.expect_error($q$select public.customer_verify_pin('JJ-2026-0136', '1111', 'x')$q$, 'permission denied', 'anon cannot call customer_verify_pin directly (no rate-limit bypass)');
select pg_temp.expect_error($q$select * from public.workshop_orders()$q$, 'permission denied', 'anon cannot list workshop jobs');
reset role;

-- server (service role) customer flows
select pg_temp.check(
  (public.customer_track('jj-2026-0136') ?& array['status','estimated_completion_date','scheduled_delivery_date'])
  and not (public.customer_track('JJ-2026-0136') ?| array['customer_phone','delivery_address','furniture_price','collectible_on_delivery','customer_name']),
  'Order-ID-only lookup returns stage + dates and strips phone/address/money');
select pg_temp.check((public.customer_verify_pin('JJ-2026-0136', '0000', 'ip-1') ->> 'ok')::boolean = false, 'wrong PIN rejected');
select pg_temp.check((public.customer_verify_pin('JJ-2026-0136', '1111', 'ip-1') ->> 'ok')::boolean, 'correct PIN accepted');
select public.customer_verify_pin('JJ-2026-0136', '9999', 'ip-2') from generate_series(1, 5);
select pg_temp.check((public.customer_verify_pin('JJ-2026-0136', '1111', 'ip-2') ->> 'locked')::boolean,
  'PIN lockout after 5 failures blocks even the right PIN (rate limit)');
select public.customer_verify_pin('JJ-2026-0136', '9999', 'rotating-' || g) from generate_series(1, 20) g;
select pg_temp.check((public.customer_verify_pin('JJ-2026-0136', '1111', 'brand-new-client') ->> 'locked')::boolean,
  'rotating client keys cannot bypass the per-order lockout (20 failures / 15 min)');
delete from public.customer_pin_attempts;

-- craftsman: no direct orders access, workshop view has no money columns
select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select pg_temp.check(count(*) = 0, 'craftsman cannot read orders table rows') from public.orders;
select pg_temp.check(count(*) = 0, 'craftsman cannot read payments') from public.payments;
select pg_temp.check(pg_get_function_result('public.workshop_orders()'::regprocedure) !~ '(price|balance|fee|collectible|payment|phone|address|pin_code)',
  'workshop_orders() returns no financial or customer-contact columns');
select pg_temp.check(count(*) >= 0, 'craftsman can call workshop_orders()') from public.workshop_orders();
reset role;

-- driver: only assigned orders
select pg_temp.act_as('00000000-0000-0000-0000-000000000004');
select pg_temp.check(count(*) = 1 and min(order_code) = 'JJ-2026-0136', 'assigned driver sees only their order')
from public.orders;
select pg_temp.check(count(*) = 1, 'driver sees own delivery assignment') from public.delivery_assignments;
select pg_temp.expect_error(
  $q$insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method, collected_by_id, verified_by_owner_or_staff)
     values ('10000000-0000-0000-0000-000000000002', gen_random_uuid(), 'Delivery Balance Collection', 100, 'Cash',
             '00000000-0000-0000-0000-000000000004', true)$q$,
  'row-level security', 'driver cannot self-verify collected cash');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000000005');
select pg_temp.check(count(*) = 0, 'unassigned driver sees no orders') from public.orders;
select pg_temp.expect_error($q$select * from public.workshop_orders()$q$, 'FORBIDDEN', 'drivers cannot list workshop jobs (prices hidden anyway)');
reset role;

-- staff: cannot approve owner-only things
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) = 2, 'staff sees all orders') from public.orders;
select pg_temp.expect_error(
  $q$update public.order_exceptions_and_repairs set status = 'Approved' where category = 'Installment Approval'$q$,
  'OWNER_ONLY', 'staff cannot approve installment exception');
select pg_temp.expect_error(
  $q$update public.orders set priority_rank = 1 where order_code = 'JJ-2026-0136'$q$,
  'OWNER_ONLY', 'staff cannot change production priority');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
update public.order_exceptions_and_repairs set status = 'Approved' where category = 'Installment Approval';
select pg_temp.check(resolved_at is not null, 'owner approves exception; resolved_at stamped')
from public.order_exceptions_and_repairs where category = 'Installment Approval';
reset role;

\echo 'ALL DATABASE TESTS PASSED'
