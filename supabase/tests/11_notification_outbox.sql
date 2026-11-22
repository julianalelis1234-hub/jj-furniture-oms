-- Migration 008: notification outbox — privileges, envelope/scrub constraints,
-- lease ownership (stale worker cannot overwrite), retry/backoff, permanent
-- failures, token-triggered scrubbing, rate limits. Runs after 10 in DB1.
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
create or replace function pg_temp.env() returns text language sql as $$
  select '{"v":"k1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA==","ct":"AAAA"}' $$;
\set QUIET off

-- ------------------------------------------------------------ privileges ----
select pg_temp.check(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('notification_outbox', 'rate_limit_hits')
              and grantee in ('anon', 'authenticated', 'PUBLIC'))
  and (select relrowsecurity from pg_class where oid = 'public.notification_outbox'::regclass),
  'outbox and rate-limit tables: RLS on, no grants to anon / authenticated');
select pg_temp.check(
  not has_function_privilege('authenticated', 'public.claim_notification_outbox(int, int, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.complete_notification_outbox(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.hit_rate_limit(text, int, int)', 'execute')
  and has_function_privilege('service_role', 'public.claim_notification_outbox(int, int, uuid)', 'execute'),
  'outbox / rate-limit functions: service role only');
select pg_temp.act_as('00000000-0000-0000-0000-000000000001'); -- even the owner (browser JWT)
select pg_temp.expect_error($q$select count(*) from public.notification_outbox$q$, 'permission denied', 'owner session cannot read the outbox directly');
select pg_temp.expect_error($q$select public.claim_notification_outbox(10, 60)$q$, 'permission denied', 'owner session cannot claim the queue');
reset role; select set_config('request.jwt.claims', '{}', false);

-- ------------------------------------------------------------- constraints ----
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key, encrypted_payload)
  values ('quote_review_ready', 'a@example.com', 'k-plain', 'raw-token-in-plaintext')$q$, 'invalid input syntax for type json', 'plaintext payloads are rejected');
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key, encrypted_payload)
  values ('quote_review_ready', 'a@example.com', 'k-partial', '{"ct":"AAAA"}')$q$, 'notification_outbox_envelope_chk', 'an incomplete envelope (no iv/tag) is rejected');
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key, delivery_status, encrypted_payload)
  values ('quote_review_ready', 'a@example.com', 'k-sent', 'sent', '{"v":"k1","iv":"x","tag":"y","ct":"z"}')$q$, 'notification_outbox_scrub_chk', 'a sent row can never keep its encrypted payload');
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key) values ('quote_review_ready', ' A@Example.com', 'k-email')$q$,
  'notification_outbox_email_chk', 'recipient emails are stored normalized');
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key, delivery_status) values ('quote_review_ready', 'a@example.com', 'k-st', 'delivered')$q$,
  'notification_outbox_status_chk', 'only pending / processing / sent / failed');
insert into public.notification_outbox (id, kind, recipient_email, idempotency_key, encrypted_payload)
values ('80000000-0000-0000-0000-000000000001', 'account_setup_link', 'lease.test@example.com', 'setup:lease-test', pg_temp.env());
select pg_temp.expect_error($q$insert into public.notification_outbox (kind, recipient_email, idempotency_key) values ('account_setup_link', 'b@example.com', 'setup:lease-test')$q$,
  'notification_outbox_idem_uidx', 'idempotency keys are unique');

-- ------------------------------------------------- lease ownership / stale worker ----
create temp table a as select processing_lease_token as lease, attempt_count from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from a) = 1 and (select attempt_count from a) = 1, 'worker A claims the row (attempt 1) with a lease token');
select pg_temp.check((select count(*) from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000001')) = 0,
  'an actively leased row cannot be claimed by another worker');
-- worker A stalls past its lease
update public.notification_outbox set processing_lease_until = now() - interval '1 second' where id = '80000000-0000-0000-0000-000000000001';
create temp table b as select processing_lease_token as lease, attempt_count from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from b) = 1 and (select lease from b) <> (select lease from a) and (select attempt_count from b) = 2,
  'after the lease expires worker B re-claims with a NEW lease token (attempt 2)');
select pg_temp.check(not public.complete_notification_outbox('80000000-0000-0000-0000-000000000001', (select lease from a), 'stale-A'),
  'stale worker A cannot mark it sent');
select pg_temp.check(not public.fail_notification_outbox('80000000-0000-0000-0000-000000000001', (select lease from a), 'stale', false, 60),
  'stale worker A cannot mark it failed');
select pg_temp.check(not public.update_notification_outbox_payload('80000000-0000-0000-0000-000000000001', (select lease from a), pg_temp.env()),
  'stale worker A cannot rewrite the payload');
select pg_temp.check(public.complete_notification_outbox('80000000-0000-0000-0000-000000000001', (select lease from b), 'provider-B'),
  'worker B (current lease) completes');
select pg_temp.check(delivery_status = 'sent' and provider_message_id = 'provider-B' and encrypted_payload is null
                     and processing_lease_token is null and processing_lease_until is null and sent_at is not null,
  'sent = accepted by provider: B''s message id kept, payload scrubbed, lease cleared')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000001';
select pg_temp.check(not public.complete_notification_outbox('80000000-0000-0000-0000-000000000001', (select lease from b), 'again'),
  'completing twice matches nothing');

-- ------------------------------------------------- retries, backoff, permanence ----
insert into public.notification_outbox (id, kind, recipient_email, idempotency_key, max_attempts, encrypted_payload)
values ('80000000-0000-0000-0000-000000000002', 'account_setup_link', 'retry.test@example.com', 'setup:retry-test', 2, pg_temp.env());
create temp table r1 as select processing_lease_token as lease from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000002');
select public.fail_notification_outbox('80000000-0000-0000-0000-000000000002', (select lease from r1), 'timeout (ambiguous)', false, 120);
select pg_temp.check(delivery_status = 'failed' and not is_permanent_failure and encrypted_payload is not null and next_retry_at > now() + interval '100 seconds'
                     and last_sanitized_error = 'timeout (ambiguous)' and processing_lease_token is null,
  'retryable failure: payload kept for the retry, backoff scheduled, lease cleared')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000002')) = 0, 'not claimable before next_retry_at');
update public.notification_outbox set next_retry_at = now() - interval '1 second' where id = '80000000-0000-0000-0000-000000000002';
create temp table r2 as select processing_lease_token as lease, idempotency_key from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000002');
select pg_temp.check((select idempotency_key from r2) = 'setup:retry-test', 'the automatic retry keeps the same idempotency key');
select public.fail_notification_outbox('80000000-0000-0000-0000-000000000002', (select lease from r2), 'timeout again', false, 60);
select pg_temp.check(is_permanent_failure and encrypted_payload is null and attempt_count = 2,
  'the last allowed attempt becomes a permanent failure and the payload is scrubbed')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000002';
update public.notification_outbox set next_retry_at = now() - interval '1 second' where id = '80000000-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000002')) = 0, 'permanent failures are never claimed again');

insert into public.notification_outbox (id, kind, recipient_email, idempotency_key) values ('80000000-0000-0000-0000-000000000003', 'account_setup_link', 'bounce@example.com', 'setup:bounce');
create temp table p1 as select processing_lease_token as lease from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000003');
select public.fail_notification_outbox('80000000-0000-0000-0000-000000000003', (select lease from p1), 'provider rejected the address (422)', true, 60);
select pg_temp.check(is_permanent_failure and attempt_count = 1, 'a permanent bounce stops retries on the first attempt')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000003';

insert into public.notification_outbox (id, kind, recipient_email, idempotency_key) values ('80000000-0000-0000-0000-000000000004', 'account_setup_link', 'noprov@example.com', 'setup:noprov');
create temp table n1 as select processing_lease_token as lease from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000004');
select public.release_notification_outbox('80000000-0000-0000-0000-000000000004', (select lease from n1), 300);
select pg_temp.check(delivery_status = 'pending' and attempt_count = 0 and processing_lease_token is null,
  'no provider configured: the row is released as pending (never marked sent), attempt not counted')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000004';

insert into public.notification_outbox (id, kind, recipient_email, idempotency_key, max_attempts, encrypted_payload)
values ('80000000-0000-0000-0000-000000000005', 'account_setup_link', 'crash@example.com', 'setup:crash', 1, pg_temp.env());
select 1 from public.claim_notification_outbox(10, 60, '80000000-0000-0000-0000-000000000005');
update public.notification_outbox set processing_lease_until = now() - interval '1 second' where id = '80000000-0000-0000-0000-000000000005';
select count(*) from public.claim_notification_outbox(10, 60);
select pg_temp.check(delivery_status = 'failed' and is_permanent_failure and encrypted_payload is null and processing_lease_token is null,
  'a worker that crashed on the final attempt leaves a permanent failure (payload scrubbed), not a stuck row')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000005';

-- ---------------------------------------------------- token-triggered scrubbing ----
insert into public.orders (id, order_code, paper_slip_number, customer_name, customer_phone, delivery_address, municipality,
  item_name, quantity, dimensions, wood_type, color_finish, furniture_price, delivery_fee, estimated_completion_date,
  furniture_category, design_variant, width_cm, height_cm, depth_cm, customer_email)
values ('81000000-0000-0000-0000-000000000001', 'DR-0881', 'S-881', 'Outbox Buyer', '09000000881', 'Purok 8', 'Lantapan',
  'Door', 1, '-', 'Mahogany', 'Natural Varnish', 9000, 500, current_date + 10, 'Panel Door', 'Classic 2-Panel', 80, 210, 4.5, 'outbox.buyer@example.com');
select public.add_spec_revision('81000000-0000-0000-0000-000000000001', 'staff_draft',
  '{"furniture_category":"Panel Door","design_variant":"Classic 2-Panel","width_cm":80,"height_cm":210,"depth_cm":4.5,"wood_type":"Mahogany","color_finish":"Natural Varnish","quoted_furniture_price":9000,"quoted_delivery_fee":500}'::jsonb, null, 'staff');
create temp table tok as select (public.issue_quote_review_token('81000000-0000-0000-0000-000000000001',
  (select revision_id from public.order_specification_revisions where order_id = '81000000-0000-0000-0000-000000000001' and revision_number = 1),
  encode(extensions.digest('outbox-raw-token', 'sha256'), 'hex')) ->> 'token_id')::uuid as token_id;
insert into public.notification_outbox (id, kind, order_id, recipient_email, review_token_id, idempotency_key, encrypted_payload)
values ('80000000-0000-0000-0000-000000000006', 'quote_review_ready', '81000000-0000-0000-0000-000000000001', 'outbox.buyer@example.com',
        (select token_id from tok), 'quote_review:outbox-test', pg_temp.env());
select pg_temp.check(not exists (select 1 from information_schema.columns where table_name = 'notification_outbox'
                                 and column_name ~ '(token$|raw|link|password|plain)' and column_name <> 'processing_lease_token'),
  'no plaintext token / link / password column exists on the outbox');
select public.consume_quote_review_token(encode(extensions.digest('outbox-raw-token', 'sha256'), 'hex'));
select pg_temp.check(encrypted_payload is null and is_permanent_failure and delivery_status = 'failed',
  'once the review token is consumed, its queued encrypted copy is scrubbed and never sent')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000006';
insert into public.notification_outbox (id, kind, order_id, recipient_email, review_token_id, idempotency_key, encrypted_payload)
values ('80000000-0000-0000-0000-000000000007', 'quote_review_ready', '81000000-0000-0000-0000-000000000001', 'outbox.buyer@example.com',
        null, 'quote_review:orphan', pg_temp.env());
select pg_temp.check(public.scrub_notification_outbox() >= 1, 'scrub_notification_outbox() clears payloads that can no longer be used');
select pg_temp.check(encrypted_payload is null, 'a quotation payload without a live review token is scrubbed')
from public.notification_outbox where id = '80000000-0000-0000-0000-000000000007';

-- ------------------------------------------------------------- rate limits ----
select pg_temp.check(public.hit_rate_limit('test:bucket', 60, 3) and public.hit_rate_limit('test:bucket', 60, 3) and public.hit_rate_limit('test:bucket', 60, 3)
                     and not public.hit_rate_limit('test:bucket', 60, 3) and public.hit_rate_limit('test:other', 60, 3),
  'rate limit: 3 per window per bucket, the 4th is refused, other buckets unaffected');
\echo 'NOTIFICATION OUTBOX TESTS PASSED'
