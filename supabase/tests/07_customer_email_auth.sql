-- Migration 005: customer email auth, single-use review tokens, verified linking.
-- Runs after 01, 04 and 05 in the same database (staff profiles exist).
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
create or replace function pg_temp.h(p text) returns text language sql as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create or replace function pg_temp.rev(p_order uuid) returns uuid language sql as $$
  select r.revision_id from public.order_specification_revisions r join public.orders o on o.id = r.order_id
  where r.order_id = p_order and r.revision_number = o.current_revision $$;
\set QUIET off

-- --------------------------------------------------------- email rules ----
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
       item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date,
       furniture_category, design_variant, width_cm, height_cm, depth_cm)
     values ('DR-0800', 'S-800', 'X', '09000000800', 'Addr', 'Valencia City', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date,
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5)$q$,
  'orders_email_or_walk_in', 'a new order needs a customer email or the walk-in flag');
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
       item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date,
       furniture_category, design_variant, width_cm, height_cm, depth_cm, legacy_contact_unknown)
     values ('DR-0800', 'S-800', 'X', '09000000800', 'Addr', 'Valencia City', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date,
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, true)$q$,
  'orders_email_or_walk_in', 'new rows cannot claim the legacy marker to skip the rule');
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
       item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date,
       furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
     values ('DR-0800', 'S-800', 'X', '09000000800', 'Addr', 'Valencia City', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date,
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, ' Maria@Example.com ')$q$,
  'orders_customer_email_normalized', 'emails are stored normalized (trim + lower case) only');
select pg_temp.expect_error(
  $q$insert into public.orders (order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
       item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date,
       furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email, has_no_email)
     values ('DR-0800', 'S-800', 'X', '09000000800', 'Addr', 'Valencia City', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date,
             'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, 'x@example.com', true)$q$,
  'orders_walk_in_has_no_email', 'a walk-in order never carries an email');

-- walk-in order (paper slip only)
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, furniture_price, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, has_no_email)
values ('50000000-0000-0000-0000-000000000001', 'DR-0801', 'S-801', 'Walk In', '09000000801', 'Purok 1, Poblacion', 'Valencia City',
  'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, current_date + 10, 'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, true);
select public.add_spec_revision('50000000-0000-0000-0000-000000000001', 'staff_draft',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quoted_furniture_price":9000,"quoted_delivery_fee":0}'::jsonb, null, 'staff');
select pg_temp.check(provisioning_status = 'not_applicable' and pin_code_hash is null and not legacy_contact_unknown,
  'walk-in: no PIN, no email, provisioning not applicable') from public.orders where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  format($q$select public.issue_quote_review_token('50000000-0000-0000-0000-000000000001', %L, %L)$q$,
         pg_temp.rev('50000000-0000-0000-0000-000000000001'), pg_temp.h('walkin')),
  'walk-in', 'no review link can be issued for a walk-in order');

-- email order
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, furniture_price, delivery_fee, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('50000000-0000-0000-0000-000000000002', 'DR-0802', 'S-802', 'Maria Email', '09000000802', 'Purok 2, Lumbo', 'Lantapan',
  'Table', 1, '-', 'Gmelina', 'Walnut Stain', 20000, 800, current_date + 14, 'Dining Table', '4-Seater Rectangular', 120, 76, 80,
  'maria.email@example.com');
select public.add_spec_revision('50000000-0000-0000-0000-000000000002', 'staff_draft',
  '{"furniture_category":"Dining Table","design_variant":"4-Seater Rectangular","width_cm":120,"height_cm":76,"depth_cm":80,"wood_type":"Gmelina","color_finish":"Walnut Stain","quoted_furniture_price":20000,"quoted_delivery_fee":800}'::jsonb, null, 'staff');
select pg_temp.check(provisioning_status = 'pending' and email_verified_at is null and customer_user_id is null,
  'email stored as UNVERIFIED (no account link) at intake') from public.orders where id = '50000000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------- review tokens ----
select public.issue_quote_review_token('50000000-0000-0000-0000-000000000002',
  pg_temp.rev('50000000-0000-0000-0000-000000000002'), pg_temp.h('tok-A'));
select pg_temp.check(count(*) = 1 and bool_and(token_hash = pg_temp.h('tok-A') and token_hash <> 'tok-A' and sent_to_email = 'maria.email@example.com'),
  'only the SHA-256 hash of the token is stored, bound to the recipient email')
from public.quote_review_tokens where order_id = '50000000-0000-0000-0000-000000000002';
select pg_temp.check((public.consume_quote_review_token(pg_temp.h('nope')) ->> 'reason') = 'invalid', 'unknown token is rejected');

-- a second link invalidates the first (one live link per order)
select public.issue_quote_review_token('50000000-0000-0000-0000-000000000002',
  pg_temp.rev('50000000-0000-0000-0000-000000000002'), pg_temp.h('tok-B'));
select pg_temp.check((public.consume_quote_review_token(pg_temp.h('tok-A')) ->> 'reason') = 'replaced', 'an older link stops working when a new one is issued');

-- expired link (backdated by the test only)
update public.quote_review_tokens set created_at = now() - interval '4 days', expires_at = now() - interval '1 second' where token_hash = pg_temp.h('tok-B');
select pg_temp.check((public.consume_quote_review_token(pg_temp.h('tok-B')) ->> 'reason') = 'expired', 'expired link is rejected');
select pg_temp.check(email_verified_at is null, 'failed attempts never verify the email') from public.orders where id = '50000000-0000-0000-0000-000000000002';

select public.issue_quote_review_token('50000000-0000-0000-0000-000000000002',
  pg_temp.rev('50000000-0000-0000-0000-000000000002'), pg_temp.h('tok-C'), 72);
create temp table consumed as select public.consume_quote_review_token(pg_temp.h('tok-C')) as r;
select pg_temp.check((r ->> 'ok')::boolean and (r ->> 'order_id') = '50000000-0000-0000-0000-000000000002'
  and (r ->> 'revision_id') = pg_temp.rev('50000000-0000-0000-0000-000000000002')::text,
  'consuming a valid link returns exactly one order + revision (the review scope)') from consumed;
select pg_temp.check(email_verified_at is not null, 'consuming the link verifies ownership of that inbox for this order')
from public.orders where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.check((public.consume_quote_review_token(pg_temp.h('tok-C')) ->> 'reason') = 'used', 'a link works exactly once (replay rejected)');

-- a newer quotation supersedes an unused link
select public.issue_quote_review_token('50000000-0000-0000-0000-000000000002',
  pg_temp.rev('50000000-0000-0000-0000-000000000002'), pg_temp.h('tok-D'));
select public.add_spec_revision('50000000-0000-0000-0000-000000000002', 'revised_quote',
  '{"furniture_category":"Dining Table","design_variant":"4-Seater Rectangular","width_cm":120,"height_cm":76,"depth_cm":80,"wood_type":"Gmelina","color_finish":"Walnut Stain","quoted_furniture_price":21000,"quoted_delivery_fee":800}'::jsonb, 1, 'staff');
select pg_temp.check((public.consume_quote_review_token(pg_temp.h('tok-D')) ->> 'reason') = 'replaced', 'a link for an outdated quotation revision is refused');
select pg_temp.expect_error(
  format($q$select public.issue_quote_review_token('50000000-0000-0000-0000-000000000002', %L, %L)$q$,
         (select revision_id from public.order_specification_revisions where order_id = '50000000-0000-0000-0000-000000000002' and revision_number = 1),
         pg_temp.h('tok-old')),
  'STALE_REVISION', 'links are issued only for the current shop quotation');

-- ----------------------------------------------------------- account linking ----
insert into auth.users (id) values ('60000000-0000-0000-0000-000000000001'), ('60000000-0000-0000-0000-000000000002');
insert into public.profiles (id, full_name, role, email) values
  ('60000000-0000-0000-0000-000000000001', 'Maria Email', 'customer', 'maria.email@example.com'),
  ('60000000-0000-0000-0000-000000000002', 'Someone Else', 'customer', 'someone.else@example.com');
select pg_temp.expect_error(
  $q$insert into public.profiles (id, full_name, role, email) values ('60000000-0000-0000-0000-000000000002', 'Dup', 'customer', ' MARIA.EMAIL@example.com')$q$,
  'duplicate key', 'one account per normalized email');
select pg_temp.expect_error(
  $q$select public.link_customer_account('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002')$q$,
  'does not match', 'an account with a different email cannot claim the order');
select pg_temp.expect_error(
  $q$select public.link_customer_account('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002')$q$,
  'not an active customer', 'a staff profile is never linked as a customer');
select public.link_customer_account('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001');
select pg_temp.check((public.link_customer_account('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001') ->> 'already')::boolean,
  'linking is idempotent (second call is a no-op)');
select pg_temp.check(customer_user_id = '60000000-0000-0000-0000-000000000001' and provisioning_status = 'linked',
  'verified order linked to the matching account') from public.orders where id = '50000000-0000-0000-0000-000000000002';

-- an unverified order cannot be linked
update public.orders set has_no_email = false, customer_email = 'maria.email@example.com' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.expect_error(
  $q$select public.link_customer_account('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001')$q$,
  'not been verified', 'adding an email to a walk-in order later still requires inbox verification before linking');

-- changing the email resets verification and unlinks the account
update public.orders set customer_email = 'new.inbox@example.com' where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.check(email_verified_at is null and customer_user_id is null and provisioning_status = 'pending',
  'changing the email resets verification and unlinks') from public.orders where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.expect_error(
  $q$update public.orders set legacy_contact_unknown = true where id = '50000000-0000-0000-0000-000000000002'$q$,
  'legacy_contact_unknown', 'the legacy marker cannot be applied by later writes');

-- -------------------------------------------------------------- RLS ----
select pg_temp.act_as('60000000-0000-0000-0000-000000000001');
select pg_temp.check(count(*) = 1 and bool_and(id = '60000000-0000-0000-0000-000000000001'),
  'a customer reads only their own profile (never staff profiles)') from public.profiles;
select pg_temp.check(count(*) = 0, 'customers have no direct access to orders (server-side projection only)') from public.orders;
select pg_temp.expect_error($q$select * from public.quote_review_tokens$q$, 'permission denied', 'customers cannot read review tokens');
select pg_temp.expect_error($q$select public.consume_quote_review_token('x')$q$, 'permission denied', 'customers cannot call the token functions directly');
select pg_temp.expect_error($q$select public.link_customer_account('50000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001')$q$,
  'permission denied', 'customers cannot link orders themselves');
update public.profiles set role = 'owner' where id = '60000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.check(role = 'customer', 'customers cannot change their own role (RLS: no update permitted)')
from public.profiles where id = '60000000-0000-0000-0000-000000000001'; select set_config('request.jwt.claims', '{}', false);
select pg_temp.act_as('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($q$select * from public.quote_review_tokens$q$, 'permission denied', 'staff cannot read review token hashes either');
reset role; select set_config('request.jwt.claims', '{}', false);
set role anon;
select pg_temp.expect_error($q$select public.issue_quote_review_token(null, null, 'x')$q$, 'permission denied', 'anon cannot issue review tokens');
reset role;

\echo 'CUSTOMER EMAIL AUTH TESTS PASSED'
