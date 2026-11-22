-- =============================================================================
-- Migration 008: reliable transactional email outbox (numbered 008: 007 is the
-- Realtime live-sync migration).
--
-- INSPECTED FIRST: no notification_outbox existed. Emails were sent inline and
-- logged (redacted) in public.notifications, which stays untouched as the
-- human-readable history. This migration creates the outbox idempotently
-- (create table if not exists + add column if not exists), so it also hardens
-- an outbox that may already exist without losing rows.
--
-- Guarantees enforced here:
--   * Only the service role touches the outbox (RLS on, no policies, grants revoked).
--   * Secrets are stored ONLY as an AES-256-GCM JSON envelope {v, iv, tag, ct};
--     a CHECK rejects anything else, and the payload must be NULL once 'sent'.
--   * Claiming is atomic (FOR UPDATE SKIP LOCKED) and commits BEFORE any
--     network I/O: the app calls claim_notification_outbox(), the function
--     returns (transaction committed), then the app talks to Resend / Gmail.
--   * Every completion / retry / release must present the lease token it got
--     from the claim; a stale worker whose lease expired matches 0 rows.
--   * 'sent' means ACCEPTED BY THE PROVIDER (provider_message_id), not inbox
--     delivery. Network timeouts are ambiguous: delivery is at-least-once, the
--     same Idempotency-Key is reused on automatic retries.
-- =============================================================================

create table if not exists public.notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null,
  order_id         uuid references public.orders (id) on delete cascade,
  recipient_email  text not null,
  customer_user_id uuid,
  review_token_id  uuid references public.quote_review_tokens (token_id) on delete set null,
  template_data    jsonb not null default '{}'::jsonb,
  idempotency_key  text not null,
  delivery_status  text not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz
);

alter table public.notification_outbox add column if not exists encrypted_payload text;
alter table public.notification_outbox add column if not exists processing_lease_token uuid;
alter table public.notification_outbox add column if not exists processing_lease_until timestamptz;
alter table public.notification_outbox add column if not exists next_retry_at timestamptz not null default now();
alter table public.notification_outbox add column if not exists attempt_count int not null default 0;
alter table public.notification_outbox add column if not exists max_attempts int not null default 5;
alter table public.notification_outbox add column if not exists is_permanent_failure boolean not null default false;
alter table public.notification_outbox add column if not exists provider_message_id text;
alter table public.notification_outbox add column if not exists last_sanitized_error text;
alter table public.notification_outbox add column if not exists requested_by_user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_status_chk') then
    alter table public.notification_outbox add constraint notification_outbox_status_chk
      check (delivery_status in ('pending', 'processing', 'sent', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_kind_chk') then
    alter table public.notification_outbox add constraint notification_outbox_kind_chk
      check (kind in ('quote_review_ready', 'order_confirmed_new_customer', 'order_confirmed_returning_customer', 'account_setup_link'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_attempts_chk') then
    alter table public.notification_outbox add constraint notification_outbox_attempts_chk
      check (attempt_count >= 0 and max_attempts > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_email_chk') then
    alter table public.notification_outbox add constraint notification_outbox_email_chk
      check (recipient_email = lower(btrim(recipient_email)) and recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_idem_chk') then
    alter table public.notification_outbox add constraint notification_outbox_idem_chk
      check (length(idempotency_key) between 1 and 256);
  end if;
  -- never plaintext: only a complete AES-GCM envelope may be stored ...
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_envelope_chk') then
    alter table public.notification_outbox add constraint notification_outbox_envelope_chk
      check (encrypted_payload is null
             or (jsonb_typeof(encrypted_payload::jsonb) = 'object' and encrypted_payload::jsonb ?& array['v', 'iv', 'tag', 'ct']));
  end if;
  -- ... and it is gone once the provider accepted the message
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_scrub_chk') then
    alter table public.notification_outbox add constraint notification_outbox_scrub_chk
      check (delivery_status <> 'sent' or encrypted_payload is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notification_outbox_lease_chk') then
    alter table public.notification_outbox add constraint notification_outbox_lease_chk
      check ((processing_lease_token is null) = (processing_lease_until is null));
  end if;
end $$;

create unique index if not exists notification_outbox_idem_uidx on public.notification_outbox (idempotency_key);
create index if not exists notification_outbox_poll_idx
  on public.notification_outbox (delivery_status, is_permanent_failure, next_retry_at, processing_lease_until);
create index if not exists notification_outbox_order_idx on public.notification_outbox (order_id, created_at);
create index if not exists notification_outbox_token_idx on public.notification_outbox (review_token_id) where encrypted_payload is not null;

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.notification_outbox to service_role;

-- ------------------------------------------------------------------- claiming ----
-- Atomically claims up to p_limit due rows (or exactly p_only_id) for one worker.
-- The UPDATE commits when this function's statement finishes, i.e. before the
-- caller performs any network I/O. Rows whose lease expired (crashed / stalled
-- worker) are claimable again with a NEW lease token.
create or replace function public.claim_notification_outbox(p_limit int, p_lease_seconds int, p_only_id uuid default null)
returns setof public.notification_outbox
language plpgsql security definer set search_path = ''
as $$
begin
  if p_lease_seconds < 5 or p_lease_seconds > 900 then raise exception 'lease must be 5..900 seconds'; end if;
  -- a stalled row that already used its last attempt becomes a permanent failure (payload scrubbed)
  update public.notification_outbox
     set delivery_status = 'failed', is_permanent_failure = true, encrypted_payload = null,
         processing_lease_token = null, processing_lease_until = null,
         last_sanitized_error = coalesce(last_sanitized_error, 'worker lease expired on the final attempt'), updated_at = now()
   where delivery_status = 'processing' and processing_lease_until < now() and attempt_count >= max_attempts;

  return query
  with due as (
    select o.id from public.notification_outbox o
     where (o.delivery_status in ('pending', 'failed')
            or (o.delivery_status = 'processing' and o.processing_lease_until < now()))
       and not o.is_permanent_failure
       and o.attempt_count < o.max_attempts
       and o.next_retry_at <= now()
       and (o.processing_lease_until is null or o.processing_lease_until < now())
       and (p_only_id is null or o.id = p_only_id)
     order by o.next_retry_at, o.created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.notification_outbox o
     set delivery_status = 'processing',
         processing_lease_token = gen_random_uuid(),
         processing_lease_until = now() + make_interval(secs => p_lease_seconds),
         attempt_count = o.attempt_count + 1,
         updated_at = now()
    from due where o.id = due.id
  returning o.*;
end;
$$;

-- Stores data needed for a retry (e.g. the encrypted set-up link) — lease holder only.
create or replace function public.update_notification_outbox_payload(p_id uuid, p_lease uuid, p_encrypted_payload text)
returns boolean
language sql security definer set search_path = ''
as $$
  with u as (
    update public.notification_outbox set encrypted_payload = p_encrypted_payload, updated_at = now()
     where id = p_id and processing_lease_token = p_lease and delivery_status = 'processing'
    returning 1)
  select exists (select 1 from u)
$$;

-- Provider accepted the message: record its id, scrub the secret, drop the lease.
create or replace function public.complete_notification_outbox(p_id uuid, p_lease uuid, p_provider_message_id text)
returns boolean
language sql security definer set search_path = ''
as $$
  with u as (
    update public.notification_outbox
       set delivery_status = 'sent', provider_message_id = left(p_provider_message_id, 200), sent_at = now(),
           encrypted_payload = null, last_sanitized_error = null,
           processing_lease_token = null, processing_lease_until = null, updated_at = now()
     where id = p_id and processing_lease_token = p_lease and delivery_status = 'processing'
    returning 1)
  select exists (select 1 from u)
$$;

-- Retryable or permanent failure (exponential backoff chosen by the caller, capped here).
create or replace function public.fail_notification_outbox(p_id uuid, p_lease uuid, p_error text, p_permanent boolean, p_retry_seconds int)
returns boolean
language sql security definer set search_path = ''
as $$
  with u as (
    update public.notification_outbox
       set delivery_status = 'failed',
           is_permanent_failure = p_permanent or attempt_count >= max_attempts,
           encrypted_payload = case when p_permanent or attempt_count >= max_attempts then null else encrypted_payload end,
           last_sanitized_error = left(p_error, 500),
           next_retry_at = now() + make_interval(secs => greatest(1, least(p_retry_seconds, 86400))),
           processing_lease_token = null, processing_lease_until = null, updated_at = now()
     where id = p_id and processing_lease_token = p_lease and delivery_status = 'processing'
    returning 1)
  select exists (select 1 from u)
$$;

-- Gives the row back untouched (e.g. no provider configured): the attempt is not counted.
create or replace function public.release_notification_outbox(p_id uuid, p_lease uuid, p_retry_seconds int)
returns boolean
language sql security definer set search_path = ''
as $$
  with u as (
    update public.notification_outbox
       set delivery_status = 'pending', attempt_count = greatest(0, attempt_count - 1),
           next_retry_at = now() + make_interval(secs => greatest(1, least(p_retry_seconds, 86400))),
           processing_lease_token = null, processing_lease_until = null, updated_at = now()
     where id = p_id and processing_lease_token = p_lease and delivery_status = 'processing'
    returning 1)
  select exists (select 1 from u)
$$;

-- Removes secrets that can no longer be used: sent / permanently failed rows and
-- quotation links whose review token was consumed, invalidated or expired.
create or replace function public.scrub_notification_outbox()
returns int
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  with s as (
    update public.notification_outbox o
       set encrypted_payload = null,
           delivery_status = case when o.delivery_status = 'sent' then 'sent' else 'failed' end,
           is_permanent_failure = o.delivery_status <> 'sent' or o.is_permanent_failure,
           last_sanitized_error = case when o.delivery_status = 'sent' then o.last_sanitized_error
                                       else coalesce(o.last_sanitized_error, 'review link no longer valid') end,
           updated_at = now()
     where o.encrypted_payload is not null
       and o.delivery_status <> 'processing'
       and (o.delivery_status = 'sent' or o.is_permanent_failure
            or (o.kind = 'quote_review_ready' and (o.review_token_id is null or exists (
                  select 1 from public.quote_review_tokens t where t.token_id = o.review_token_id
                   and (t.consumed_at is not null or t.invalidated_at is not null or t.expires_at <= now())))))
    returning 1)
  select count(*) into n from s;
  return n;
end;
$$;

-- The moment a review token is consumed or replaced, its queued copy is scrubbed.
create or replace function private.scrub_outbox_on_token_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.consumed_at is not null and old.consumed_at is null) or (new.invalidated_at is not null and old.invalidated_at is null) then
    update public.notification_outbox
       set encrypted_payload = null,
           delivery_status = case when delivery_status = 'sent' then 'sent' else 'failed' end,
           is_permanent_failure = delivery_status <> 'sent' or is_permanent_failure,
           last_sanitized_error = case when delivery_status = 'sent' then last_sanitized_error else 'review link no longer valid' end,
           processing_lease_token = case when delivery_status = 'sent' then processing_lease_token else null end,
           processing_lease_until = case when delivery_status = 'sent' then processing_lease_until else null end,
           updated_at = now()
     where review_token_id = new.token_id and encrypted_payload is not null
       and delivery_status <> 'processing'; -- an in-flight row is left to its worker (it re-checks the token; scrub_notification_outbox() cleans up after)
  end if;
  return new;
end;
$$;
drop trigger if exists quote_review_tokens_scrub_outbox on public.quote_review_tokens;
create trigger quote_review_tokens_scrub_outbox after update on public.quote_review_tokens
  for each row execute function private.scrub_outbox_on_token_change();

-- ---------------------------------------------------------------- rate limits ----
-- Fixed-window counters keyed by opaque bucket strings (the app passes an HMAC of
-- the normalized email, never the email itself).
create table if not exists public.rate_limit_hits (
  bucket   text not null check (length(bucket) between 1 and 200),
  hit_at   timestamptz not null default now()
);
create index if not exists rate_limit_hits_bucket_idx on public.rate_limit_hits (bucket, hit_at);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;

create or replace function public.hit_rate_limit(p_bucket text, p_window_seconds int, p_max int)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_bucket, 0));
  delete from public.rate_limit_hits where bucket = p_bucket and hit_at < now() - make_interval(secs => p_window_seconds);
  -- bounded global cleanup: buckets that are never hit again do not accumulate forever
  delete from public.rate_limit_hits where ctid in (
    select ctid from public.rate_limit_hits where hit_at < now() - interval '1 day' limit 200);
  select count(*) into n from public.rate_limit_hits where bucket = p_bucket;
  if n >= p_max then return false; end if;
  insert into public.rate_limit_hits (bucket) values (p_bucket);
  return true;
end;
$$;

-- --------------------------------------------------------------- privileges ----
revoke all on function public.claim_notification_outbox(int, int, uuid) from public, anon, authenticated;
revoke all on function public.update_notification_outbox_payload(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_notification_outbox(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_notification_outbox(uuid, uuid, text, boolean, int) from public, anon, authenticated;
revoke all on function public.release_notification_outbox(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.scrub_notification_outbox() from public, anon, authenticated;
revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function private.scrub_outbox_on_token_change() from public;
grant execute on function public.claim_notification_outbox(int, int, uuid) to service_role;
grant execute on function public.update_notification_outbox_payload(uuid, uuid, text) to service_role;
grant execute on function public.complete_notification_outbox(uuid, uuid, text) to service_role;
grant execute on function public.fail_notification_outbox(uuid, uuid, text, boolean, int) to service_role;
grant execute on function public.release_notification_outbox(uuid, uuid, int) to service_role;
grant execute on function public.scrub_notification_outbox() to service_role;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;
