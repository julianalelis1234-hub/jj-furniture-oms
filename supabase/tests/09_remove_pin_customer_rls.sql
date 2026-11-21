-- Migration 006: PIN / Order-ID endpoints removed, historical PIN data kept,
-- customers see only their own orders (RLS), nothing else.
-- Runs after 07 in the same database (customer 6..01 is linked to order 5..02 there, then unlinked by an email change).
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
create or replace function pg_temp.act_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
  execute 'set role authenticated';
end $$;
\set QUIET off
select pg_temp.check(to_regprocedure('public.customer_verify_pin(text, text, text)') is null
                     and to_regprocedure('public.customer_track(text)') is null,
  'no Order ID + PIN endpoints remain (customer_verify_pin / customer_track dropped)');
select pg_temp.check(to_regclass('public.customer_pin_attempts') is not null
  and exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'pin_code_hash')
  and exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'pin_code_display'),
  'historical PIN data kept: pin_code_hash / pin_code_display columns and the customer_pin_attempts table');

create temp table all_orders as select count(*) as n from public.orders;
grant select on all_orders to authenticated;

-- link a verified order to customer A, leave another verified order on customer B
update public.orders set customer_email = 'maria.email@example.com' where id = '50000000-0000-0000-0000-000000000001';
select public.issue_quote_review_token('50000000-0000-0000-0000-000000000001',
  (select r.revision_id from public.order_specification_revisions r join public.orders o on o.id = r.order_id
   where o.id = '50000000-0000-0000-0000-000000000001' and r.revision_number = o.current_revision),
  encode(extensions.digest('rls-A', 'sha256'), 'hex'));
select public.consume_quote_review_token(encode(extensions.digest('rls-A', 'sha256'), 'hex'));
select public.link_customer_account('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001');

select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select pg_temp.check(count(*) = 1 and bool_and(id = '50000000-0000-0000-0000-000000000001'),
  'RLS: a customer reads exactly their own linked order row') from public.orders;
select pg_temp.check(count(*) = 0, 'RLS: no revision rows for customers') from public.order_specification_revisions;
select pg_temp.check(count(*) = 0, 'RLS: no payment rows for customers') from public.payments;
select pg_temp.check(count(*) = 0, 'RLS: no confirmation rows for customers') from public.order_confirmations;
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.act_as('60000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) = 0, 'RLS: another customer sees none of those orders') from public.orders;
reset role; select set_config('request.jwt.claims', '{}', false);
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.check(count(*) filter (where customer_user_id is null) >= 1
  and count(*) filter (where id = '50000000-0000-0000-0000-000000000001') = 1
  and count(*) = (select n from pg_temp.all_orders),
  'staff still see every order, linked and unlinked (legacy) alike') from public.orders;
reset role; select set_config('request.jwt.claims', '{}', false);
\echo 'MIGRATION 006 (PIN REMOVAL + CUSTOMER RLS) TESTS PASSED'
