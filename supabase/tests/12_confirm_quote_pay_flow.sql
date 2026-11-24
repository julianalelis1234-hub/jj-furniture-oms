-- Migration 009: submit -> confirm -> quotation -> accept + plan -> customer payments
-- -> verify / reject -> 30% production gate -> production lock. Runs on the full schema.
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
create or replace function pg_temp.accept(p_order uuid, p_plan text, p_method text default null) returns jsonb language plpgsql as $$
declare r record; o record;
begin
  select * into o from public.orders where id = p_order;
  select * into r from public.order_specification_revisions where order_id = p_order and revision_number = o.current_revision;
  return public.accept_order_revision(p_order, r.revision_id, r.revision_number, r.quoted_furniture_price,
    r.quoted_delivery_fee, r.quoted_furniture_price + r.quoted_delivery_fee, gen_random_uuid()::text,
    'Customer Portal PIN'::public.confirmation_method, 'Customer', null, null, p_plan, p_method::public.payment_method);
end $$;
\set QUIET off

-- ---------------------------------------------------------------- submit ----
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, delivery_fee, status, order_origin, client_request_key,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('90000000-0000-0000-0000-000000000001', 'JJ-2026-9001', 'JJ-2026-9001', 'Rosa Daguman', '0900-000-9001',
  'Purok 3, Poblacion, near the plaza', 'Valencia City', 'Classic 2-Panel Panel Door', 1, '80.0 × 210.0 × 4.5 cm (W × H × D)',
  'Mahogany', 'Natural Varnish', 0, 'Waiting for Confirmation', 'customer_self_service', 'req-9001',
  'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, 'rosa@example.com');
select public.add_spec_revision('90000000-0000-0000-0000-000000000001', 'customer_request',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quantity":1}'::jsonb,
  null, 'customer');
select pg_temp.check(status = 'Waiting for Confirmation' and order_code = paper_slip_number and furniture_price is null
                     and confirmed_at is null and quotation_issued_at is null,
  'an online submission waits for confirmation with its final JJ code as the slip and no price yet')
from public.orders where id = '90000000-0000-0000-0000-000000000001';

select pg_temp.expect_error($q$select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'down_30')$q$,
  'PENDING_REVIEW', 'a customer cannot accept before the shop issues a quotation');

-- --------------------------------------------------------------- confirm ----
update public.orders set status = 'Confirmed' where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(status = 'Confirmed' and confirmed_at is not null and not specs_confirmed and quotation_issued_at is null,
  'the shop confirms the order without a price: Confirmed, confirmed_at set, nothing accepted yet')
from public.orders where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$update public.orders set status = 'In Production' where id = '90000000-0000-0000-0000-000000000001'$q$,
  'issue the quotation', 'production cannot start before the quotation is issued');
select pg_temp.expect_error($q$select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'down_30')$q$,
  'PENDING_REVIEW', 'a confirmed order without an issued quotation cannot be accepted');

-- ------------------------------------------------------------- quotation ----
select public.add_spec_revision('90000000-0000-0000-0000-000000000001', 'revised_quote',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quantity":1,"quoted_furniture_price":10000,"quoted_delivery_fee":0}'::jsonb,
  1, 'staff', null, '{}'::jsonb, 7, null, current_date + 21);
select pg_temp.check(status = 'Confirmed' and quotation_issued_at is not null and furniture_price = 10000
                     and standard_down_payment_due = 3000 and current_revision = 2,
  'issuing the quotation keeps the order Confirmed, records quotation_issued_at and sets the 30% due (3,000)')
from public.orders where id = '90000000-0000-0000-0000-000000000001';

select pg_temp.expect_error($q$select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'weekly')$q$,
  'VALIDATION', 'an unknown payment plan is rejected');

select pg_temp.check(not exists (select 1 from public.workshop_orders() w where w.id = '90000000-0000-0000-0000-000000000001'),
  'craftsmen do not see a confirmed order while its quotation is still open');

-- ------------------------------------------------------ accept + plan ----
select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'down_30', 'Online Payment (GCash / Maya)');
select pg_temp.check(status = 'Confirmed' and specs_confirmed and approved_revision_number = 2 and payment_plan = 'down_30'
                     and preferred_payment_method = 'Online Payment (GCash / Maya)',
  'accepting the quotation records the plan and channel and does not change the status')
from public.orders where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(exists (select 1 from public.workshop_orders() w where w.id = '90000000-0000-0000-0000-000000000001'),
  'once the quotation is accepted the job appears in the workshop list (Up next)');
select pg_temp.check((confirmed_specs_snapshot ->> 'payment_plan') = 'down_30',
  'the immutable acceptance snapshot includes the chosen payment plan')
from public.order_confirmations where order_id = '90000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'full')$q$,
  'ALREADY_ACCEPTED', 'the same quotation cannot be accepted twice with a new key');

-- -------------------------------------------- customer-submitted payments ----
select pg_temp.expect_error($q$insert into public.payments (order_id, client_transaction_id, payment_type, amount, payment_method)
  values ('90000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Down Payment (30%)', 3000, 'Bank Transfer')$q$,
  'payments_online_reference_chk', 'a bank transfer without a reference number is rejected');
insert into public.payments (id, order_id, client_transaction_id, payment_type, amount, payment_method, reference_number, proof_path)
values ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'Down Payment (30%)', 3000, 'Online Payment (GCash / Maya)', 'GC-0012345', 'JJ-2026-9001/proof-1.jpg');
select pg_temp.expect_error($q$update public.orders set status = 'In Production' where id = '90000000-0000-0000-0000-000000000001'$q$,
  'DOWN_PAYMENT_REQUIRED', 'an unverified customer payment does not open the production gate');

-- reject once, with a reason; a rejected payment can never be verified
select pg_temp.expect_error($q$update public.payments set rejected_at = now() where id = '91000000-0000-0000-0000-000000000001'$q$,
  'payments_rejection_chk', 'rejecting a payment needs a reason');
update public.payments set rejected_at = now(), rejection_reason = 'Reference number not found in GCash'
where id = '91000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$update public.payments set verified_by_owner_or_staff = true where id = '91000000-0000-0000-0000-000000000001'$q$,
  'rejected payment cannot be verified', 'a rejected payment cannot be verified later');
select pg_temp.expect_error($q$update public.payments set reference_number = 'GC-999' where id = '91000000-0000-0000-0000-000000000001'$q$,
  'IMMUTABLE_RECORD', 'the reference number and proof of a submitted payment are immutable');

insert into public.payments (id, order_id, client_transaction_id, payment_type, amount, payment_method, reference_number, proof_path)
values ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', gen_random_uuid(),
  'Down Payment (30%)', 3000, 'Online Payment (GCash / Maya)', 'GC-0054321', 'JJ-2026-9001/proof-2.jpg');
update public.payments set verified_by_owner_or_staff = true where id = '91000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$update public.payments set rejected_at = now(), rejection_reason = 'x' where id = '91000000-0000-0000-0000-000000000002'$q$,
  'verified payment cannot be rejected', 'a verified payment cannot be rejected');
update public.orders set status = 'Confirmed' where id = '90000000-0000-0000-0000-000000000001'; -- recompute balances
select pg_temp.check(remaining_furniture_balance = 7000, 'only the verified payment counts toward the balance (7,000 left)')
from public.orders where id = '90000000-0000-0000-0000-000000000001';

-- a new quotation after acceptance voids the acceptance and the plan
select public.add_spec_revision('90000000-0000-0000-0000-000000000001', 'revised_quote',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quantity":1,"quoted_furniture_price":10000,"quoted_delivery_fee":0}'::jsonb,
  2, 'staff');
select pg_temp.check(status = 'Confirmed' and not specs_confirmed and approved_revision_number is null and payment_plan is null,
  'a re-issued quotation voids the earlier acceptance and plan; the order stays Confirmed')
from public.orders where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$update public.orders set status = 'In Production' where id = '90000000-0000-0000-0000-000000000001'$q$,
  'SPECS_NOT_CONFIRMED', 'production needs the latest quotation accepted');
select pg_temp.accept('90000000-0000-0000-0000-000000000001', 'down_30', 'Cash');

-- ------------------------------------------------ production + the lock ----
update public.orders set status = 'In Production' where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(status = 'In Production', 'the accepted quotation + verified 30% opens production')
from public.orders where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$select public.add_spec_revision('90000000-0000-0000-0000-000000000001', 'customer_proposal',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":90,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish"}'::jsonb, 3, 'customer')$q$,
  'SPEC_LOCKED', 'the production lock: a customer change request is refused once production starts');
select pg_temp.expect_error($q$update public.orders set width_cm = 95 where id = '90000000-0000-0000-0000-000000000001'$q$,
  'SPEC_LOCKED', 'the production lock: a direct specification edit is refused once production starts');

-- ---------------------------------------------------- installment plan ----
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, delivery_fee, furniture_price, estimated_completion_date, status,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('90000000-0000-0000-0000-000000000002', 'JJ-2026-9002', 'S-9002', 'Ben Salvador', '0900-000-9002',
  'Purok 7, Lumbo', 'Valencia City', 'Dining Table', 1, '-', 'Gmelina', 'Walnut Stain', 0, 15000, current_date + 30,
  'Waiting for Confirmation', 'Dining Table', 'Classic', 180, 76, 90, 'ben@example.com');
select public.add_spec_revision('90000000-0000-0000-0000-000000000002', 'staff_draft',
  '{"furniture_category":"Dining Table","design_variant":"Classic","width_cm":180,"height_cm":76,"depth_cm":90,"wood_type":"Gmelina","color_finish":"Walnut Stain","quantity":1,"quoted_furniture_price":15000,"quoted_delivery_fee":0}'::jsonb,
  null, 'staff');
select pg_temp.check(status = 'Waiting for Confirmation' and quotation_issued_at is null,
  'a walk-in draft before confirmation is not yet an issued quotation')
from public.orders where id = '90000000-0000-0000-0000-000000000002';
update public.orders set status = 'Confirmed' where id = '90000000-0000-0000-0000-000000000002';
select public.add_spec_revision('90000000-0000-0000-0000-000000000002', 'revised_quote',
  '{"furniture_category":"Dining Table","design_variant":"Classic","width_cm":180,"height_cm":76,"depth_cm":90,"wood_type":"Gmelina","color_finish":"Walnut Stain","quantity":1,"quoted_furniture_price":15000,"quoted_delivery_fee":0}'::jsonb,
  1, 'staff');
select pg_temp.accept('90000000-0000-0000-0000-000000000002', 'installment', 'Bank Transfer');
select pg_temp.check(o.payment_plan = 'installment' and o.payment_exception_type = 'Installment' and not o.payment_exception_approved
                     and exists (select 1 from public.order_exceptions_and_repairs e where e.order_id = o.id
                                 and e.category = 'Installment Approval' and e.status = 'Pending'),
  'choosing installment queues an owner approval (Installment Approval)')
from public.orders o where o.id = '90000000-0000-0000-0000-000000000002';

-- ----------------------------------------------------- account claiming ----
alter table auth.users add column if not exists email_confirmed_at timestamptz; -- emulates Supabase Auth
insert into auth.users (id, email) values ('92000000-0000-0000-0000-000000000001', 'rosa@example.com') on conflict do nothing;
insert into public.profiles (id, full_name, role, email)
values ('92000000-0000-0000-0000-000000000001', 'Rosa Daguman', 'customer', 'rosa@example.com') on conflict do nothing;
select pg_temp.expect_error($q$select public.claim_customer_orders('92000000-0000-0000-0000-000000000001')$q$,
  'not confirmed', 'claiming is refused while the account email is unconfirmed (no set-up link completed)');
update auth.users set email_confirmed_at = now() where id = '92000000-0000-0000-0000-000000000001';
select pg_temp.check(public.claim_customer_orders('92000000-0000-0000-0000-000000000001') = 0,
  'a confirmed order is not linked until its confirmation email was addressed to this account');
insert into public.notification_outbox (kind, order_id, recipient_email, customer_user_id, idempotency_key)
values ('order_confirmed_new_customer', '90000000-0000-0000-0000-000000000001', 'rosa@example.com',
        '92000000-0000-0000-0000-000000000001', 'order_confirmed_new:9001');
-- a second, unconfirmed submission with the same email must stay unlinked
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, delivery_fee, status, order_origin, client_request_key,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('90000000-0000-0000-0000-000000000003', 'JJ-2026-9003', 'JJ-2026-9003', 'Someone', '0900-000-9003',
  'Purok 1, Poblacion', 'Valencia City', 'Door', 1, '-', 'Mahogany', 'Natural Varnish', 0, 'Waiting for Confirmation',
  'customer_self_service', 'req-9003', 'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, 'rosa@example.com');
select pg_temp.check(public.claim_customer_orders('92000000-0000-0000-0000-000000000001') = 1,
  'claiming links exactly the one shop-confirmed order with the same email');
select pg_temp.check(customer_user_id = '92000000-0000-0000-0000-000000000001' and provisioning_status = 'linked' and email_verified_at is not null,
  'the claimed order now belongs to the account and its email counts as verified')
from public.orders where id = '90000000-0000-0000-0000-000000000001';
select pg_temp.check(customer_user_id is null and email_verified_at is null,
  'an unconfirmed submission with the same email is never linked')
from public.orders where id = '90000000-0000-0000-0000-000000000003';
select pg_temp.check(public.claim_customer_orders('92000000-0000-0000-0000-000000000001') = 0, 'claiming is idempotent');
select pg_temp.check(not has_function_privilege('authenticated', 'public.claim_customer_orders(uuid)', 'execute'),
  'claim_customer_orders is service-role only');
select pg_temp.check(exists (select 1 from pg_constraint where conname = 'notification_outbox_kind_chk'
                             and pg_get_constraintdef(oid) like '%quotation_payment_request%'),
  'the outbox accepts the quotation_payment_request email');

\echo 'PASSED: 12_confirm_quote_pay_flow'
