-- Migration 007: Realtime change feed. Authorization (grants, RLS per role,
-- publication), server-side transition classification, money-free payloads.
-- Runs after 07 and 09 in the same database: order 5..01 is linked to customer
-- 6..01; customer 6..02 owns nothing; staff 0..02, craftsman 0..03, driver 0..04.
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
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
end $$;
\set QUIET off

-- ------------------------------------------------------------ authorization ----
select pg_temp.check(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'order_live_events' and grantee = 'authenticated') = array['SELECT']
  and not exists (select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'order_live_events' and grantee in ('anon', 'PUBLIC')),
  'feed table: authenticated may only SELECT; anon and PUBLIC have nothing');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'public.order_live_events'::regclass), 'feed table has RLS enabled');
select pg_temp.check(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'order_live_events')
  and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                  and tablename in ('orders', 'payments', 'order_confirmations', 'order_specification_revisions', 'delivery_assignments', 'profiles')),
  'only the money-free feed is published; operational tables (full rows) are not');
select pg_temp.check(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_live_events'
              and column_name ~ '(price|amount|fee|balance|note|email|phone|address|token|hash|customer_user_id|collected_by|verified_by|name)'),
  'feed payload has no money, notes, contact, token or person columns');

-- --------------------------------------------------- classification ----
-- (a) a self-service request -> quote_requested
insert into public.orders (id, order_code, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, delivery_fee, status, order_origin, client_request_key,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('70000000-0000-0000-0000-000000000001', 'DR-0790', 'Rt Request', '09000000700', 'Purok 7', 'Lantapan',
  'Classic 2-Panel Panel Door', 1, '80 × 210 × 4.5 cm', 'Gmelina', 'Natural Varnish', 0, 'Quote Requested', 'customer_self_service', 'rt-req-1',
  'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, 'rt.request@example.com');
select pg_temp.check(count(*) = 1 and bool_and(transition = 'quote_requested' and op = 'INSERT' and actor_role = 'system'),
  'a new Quote Requested order is classified quote_requested')
from public.order_live_events where order_id = '70000000-0000-0000-0000-000000000001' and source = 'orders';

-- (b) an internal note edit is an UPDATE with NO transition (never "quotation confirmed")
create temp table mark as select coalesce(max(id), 0) as id from public.order_live_events;
grant select on mark to authenticated;
update public.orders set special_instructions = 'internal: call before delivery' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check(count(*) = 1 and bool_and(transition is null and status = prev_status),
  'editing a note emits a change signal with no transition')
from public.order_live_events where id > (select id from mark) and order_id = '50000000-0000-0000-0000-000000000001';

-- (c) acceptance through accept_order_revision -> quote_accepted (committed confirmation for the active revision)
select pg_temp.check(status = 'Waiting for Confirmation', 'fixture: linked order awaits confirmation')
from public.orders where id = '50000000-0000-0000-0000-000000000001';
truncate mark; insert into mark select coalesce(max(id), 0) from public.order_live_events;
select tests.accept('50000000-0000-0000-0000-000000000001', (select current_revision from public.orders where id = '50000000-0000-0000-0000-000000000001'),
  'Signed Paper Slip', 'Rt Customer', '00000000-0000-0000-0000-000000000002');
select pg_temp.check(
  exists (select 1 from public.order_live_events where id > (select id from mark) and source = 'order_confirmations' and transition is null)
  and (select count(*) from public.order_live_events where id > (select id from mark) and source = 'orders'
       and transition = 'quote_accepted' and prev_status = 'Waiting for Confirmation' and status = 'Confirmed') = 1,
  'Waiting -> Confirmed with a committed confirmation is classified quote_accepted (once)');

-- (d) an UNVERIFIED driver collection is never a verified payment
truncate mark; insert into mark select coalesce(max(id), 0) from public.order_live_events;
insert into public.payments (id, order_id, client_transaction_id, payment_type, amount, payment_method, collected_by_id, verified_by_owner_or_staff)
values ('71000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Down Payment (30%)', 2700, 'Cash',
        '00000000-0000-0000-0000-000000000004', false);
select pg_temp.check(
  (select count(*) from public.order_live_events where id > (select id from mark) and source = 'payments'
     and payment_verified = false and transition is null) = 1
  and not exists (select 1 from public.order_live_events where id > (select id from mark) and transition = 'payment_verified'),
  'unverified driver collection: payments signal with verified=false and no payment_verified transition');
select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select pg_temp.check(count(*) = 0, 'the customer cannot see the unverified payment signal')
from public.order_live_events where source = 'payments' and order_id = '50000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
-- staff verify it at the handover
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
update public.payments set verified_by_owner_or_staff = true where id = '71000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select pg_temp.check(count(*) = 1 and bool_and(payment_verified and actor_role = 'staff'),
  'staff verification is classified payment_verified (once)')
from public.order_live_events where source = 'payments' and transition = 'payment_verified' and record_id = '71000000-0000-0000-0000-000000000001';

-- (e) 7-stage progress: Confirmed -> In Production
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
update public.orders set status = 'In Production' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select pg_temp.check(count(*) = 1, 'Confirmed -> In Production is classified stage_progress')
from public.order_live_events where order_id = '50000000-0000-0000-0000-000000000001' and transition = 'stage_progress'
  and prev_status = 'Confirmed' and status = 'In Production';
select pg_temp.check(not exists (select 1 from public.order_live_events where transition = 'stage_progress'
                                 and (status = 'Quote Requested' or prev_status = 'Quote Requested')),
  'Quote Requested is never treated as one of the 7 main stages');

-- driver assignment for a second order only (5..02 stays unassigned)
insert into public.delivery_assignments (order_id, driver_id, vehicle_type, scheduled_date, delivery_fee, expected_collectible_amount)
select '50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', vehicle_type, current_date + 3, 0, 6300
from (select enum_range(null::public.vehicle_type) as r) v, lateral (select (v.r)[1] as vehicle_type) x;

-- workshop -> inspection -> ready for delivery (craftsman, then owner), so the driver has delivery-stage signals
-- (craftsmen change status through the server's narrowly scoped workflow, i.e. without a JWT)
update public.orders set status = 'Completed / For Inspection' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.act_as('00000000-0000-0000-0000-000000000001');
update public.orders set status = 'Ready for Delivery' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select pg_temp.check(count(*) = 2 and bool_and(transition = 'stage_progress'), 'workshop and inspection steps are stage_progress signals')
from public.order_live_events where order_id = '50000000-0000-0000-0000-000000000001'
  and prev_status in ('In Production', 'Completed / For Inspection') and source = 'orders' and status <> prev_status;

-- ------------------------------------------------------------- RLS per role ----
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) = (select count(*) from public.order_live_events), 'staff read the whole feed') from public.order_live_events;
select pg_temp.as_admin();

select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select pg_temp.check(count(*) > 0 and bool_and(order_id = '50000000-0000-0000-0000-000000000001'),
  'customer: only signals for their own linked order') from public.order_live_events;
select pg_temp.check(bool_and(source in ('orders', 'order_confirmations', 'payments')) and bool_and(source <> 'payments' or payment_verified),
  'customer: order / confirmation signals and VERIFIED payments only (no revisions, no assignments)') from public.order_live_events;
select pg_temp.as_admin();
select pg_temp.act_as('60000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) = 0, 'another customer sees none of it') from public.order_live_events;
select pg_temp.as_admin();

select pg_temp.act_as('00000000-0000-0000-0000-000000000003');
select pg_temp.check(count(*) > 0 and bool_and(source = 'orders')
  and bool_and(status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')
               or prev_status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')),
  'craftsman: workshop-stage order signals only (same scope as workshop_orders())') from public.order_live_events;
select pg_temp.check(count(*) = 0, 'craftsman: zero payment, confirmation or quotation signals')
from public.order_live_events where source <> 'orders' or transition in ('quote_requested', 'quote_accepted', 'payment_verified');
select pg_temp.check(count(*) = 0, 'craftsman: no Quote Requested order is visible') from public.order_live_events where order_id = '70000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();

select pg_temp.act_as('00000000-0000-0000-0000-000000000004');
select pg_temp.check(count(*) > 0 and bool_and(order_id = '50000000-0000-0000-0000-000000000001') and bool_and(source in ('orders', 'delivery_assignments')),
  'driver: only the assigned order, order + assignment signals only') from public.order_live_events;
select pg_temp.check(count(*) >= 1, 'driver: sees the order reach Ready for Delivery')
from public.order_live_events where source = 'orders' and status = 'Ready for Delivery';
select pg_temp.check(count(*) = 0, 'driver: no earlier quotation / production history of the newly assigned order')
from public.order_live_events where source = 'orders' and status not in ('Ready for Delivery', 'Out for Delivery', 'Delivered')
  and prev_status not in ('Ready for Delivery', 'Out for Delivery', 'Delivered');
select pg_temp.check(count(*) = 0, 'driver: zero payment or quotation signals') from public.order_live_events where source = 'payments' or transition in ('quote_requested', 'quote_accepted', 'payment_verified');

-- nobody but the trigger writes the feed
select pg_temp.expect_error($q$insert into public.order_live_events (source, op, record_id, order_id) values ('orders', 'UPDATE', gen_random_uuid(), gen_random_uuid())$q$,
  'permission denied', 'clients cannot insert fake signals');
select pg_temp.expect_error($q$update public.order_live_events set transition = 'quote_accepted'$q$, 'permission denied', 'clients cannot rewrite signals');
select pg_temp.expect_error($q$delete from public.order_live_events$q$, 'permission denied', 'clients cannot delete signals');
select pg_temp.as_admin();
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($q$delete from public.order_live_events$q$, 'permission denied', 'not even the owner/staff can delete signals');
select pg_temp.as_admin();
set role anon;
select pg_temp.expect_error($q$select 1 from public.order_live_events$q$, 'permission denied', 'anon cannot read the feed');
reset role;

-- DELETE of an order is announced explicitly (no row data)
delete from public.orders where id = '70000000-0000-0000-0000-000000000001';
select pg_temp.check(count(*) = 1, 'deleting an order emits an explicit DELETE signal')
from public.order_live_events where order_id = '70000000-0000-0000-0000-000000000001' and op = 'DELETE';
\echo 'REALTIME LIVE FEED TESTS PASSED'
