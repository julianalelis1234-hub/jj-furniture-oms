-- =============================================================================
-- Migration 005b: customer email authentication, single-use quote review
-- tokens and post-acceptance account provisioning / linking.
--
-- Legacy-safe and data-preserving:
--  * no existing row is reclassified, no email is invented;
--  * "email or walk-in" is enforced for NEW rows (server actions + a NOT VALID
--    constraint), so historical orders with neither stay intact;
--  * the approval engine (add_spec_revision, accept_order_revision, the
--    orders trigger, immutable revisions / confirmations, payments guard) is
--    not modified.
-- =============================================================================

-- ------------------------------------------------------------- profiles ----
-- 'customer' (005a) is assigned ONLY by server code with the service role.
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_uidx on public.profiles (lower(trim(email))) where email is not null;
do $$ begin
  alter table public.profiles add constraint profiles_customer_email_required
    check (role <> 'customer' or email is not null);
exception when duplicate_object then null; end $$;

-- Customers must never read staff profiles: the old policy allowed any role.
drop policy if exists profiles_select_staff on public.profiles;
create policy profiles_select_staff on public.profiles for select to authenticated
  using ((select private.app_role()) in ('owner', 'staff', 'craftsman', 'driver'));
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));

-- --------------------------------------------------------------- orders ----
alter table public.orders
  add column if not exists customer_email      text,
  add column if not exists customer_user_id    uuid references public.profiles (id),
  add column if not exists email_verified_at   timestamptz,
  add column if not exists has_no_email        boolean not null default false,
  add column if not exists provisioning_status text not null default 'not_applicable';

-- New orders get no PIN; existing paper-slip PINs keep working.
alter table public.orders alter column pin_code_hash drop not null;

do $$ begin
  alter table public.orders add constraint orders_provisioning_status_check check (provisioning_status in
    ('not_applicable', 'pending', 'account_created', 'setup_email_pending', 'setup_email_sent', 'linked', 'failed'));
  alter table public.orders add constraint orders_customer_email_normalized check (
    customer_email is null
    or (customer_email = lower(trim(customer_email)) and customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
  -- a walk-in (paper slip only) never carries an email
  alter table public.orders add constraint orders_walk_in_has_no_email check (not has_no_email or customer_email is null);
  -- an order is linked to an account only after inbox ownership was verified for THIS order
  alter table public.orders add constraint orders_link_requires_verification check (customer_user_id is null or email_verified_at is not null);
  alter table public.orders add constraint orders_verification_requires_email check (email_verified_at is null or customer_email is not null);
exception when duplicate_object then null; end $$;

-- Email-or-walk-in for every new order. Historical rows that have neither are
-- marked once with a legacy discriminator (NOT reclassified as walk-ins, no
-- email invented). A plain NOT VALID check is not enough: Postgres re-checks it
-- on every UPDATE, which would block status changes on those legacy rows.
alter table public.orders add column if not exists legacy_contact_unknown boolean not null default false;
update public.orders set legacy_contact_unknown = true
where customer_email is null and not has_no_email and not legacy_contact_unknown
  and created_at < now(); -- existing rows only (this migration's transaction)
alter table public.orders drop constraint if exists orders_email_or_walk_in;
alter table public.orders add constraint orders_email_or_walk_in
  check (has_no_email or customer_email is not null or legacy_contact_unknown);

create index if not exists orders_customer_user_idx on public.orders (customer_user_id) where customer_user_id is not null;
create index if not exists orders_customer_email_idx on public.orders (customer_email) where customer_email is not null;

-- Changing the email resets verification and unlinks the account (the new inbox must be verified again).
create or replace function private.orders_email_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- the legacy marker can only be cleared, never (re)applied by later writes
  if tg_op = 'INSERT' then new.legacy_contact_unknown := false; end if;
  if tg_op = 'UPDATE' and new.legacy_contact_unknown and not old.legacy_contact_unknown then
    raise exception 'VALIDATION: legacy_contact_unknown is set only by migration 005' using errcode = 'P0001';
  end if;
  if new.customer_email is not null or new.has_no_email then new.legacy_contact_unknown := false; end if;
  if tg_op = 'UPDATE' and new.customer_email is distinct from old.customer_email then
    new.email_verified_at := null;
    new.customer_user_id := null;
    new.provisioning_status := case when new.customer_email is null then 'not_applicable' else 'pending' end;
  end if;
  if tg_op = 'INSERT' and new.customer_email is not null and new.provisioning_status = 'not_applicable' then
    new.provisioning_status := 'pending';
  end if;
  if new.has_no_email then new.provisioning_status := 'not_applicable'; end if;
  return new;
end; $$;
drop trigger if exists orders_email_guard on public.orders;
create trigger orders_email_guard
  before insert or update of customer_email, has_no_email, legacy_contact_unknown on public.orders
  for each row execute function private.orders_email_guard();

-- --------------------------------------------------------- notifications ----
alter table public.notifications add column if not exists recipient_email text;

-- --------------------------------------------------- quote_review_tokens ----
create table if not exists public.quote_review_tokens (
  token_id        uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  revision_id     uuid not null references public.order_specification_revisions (revision_id),
  token_hash      text unique not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- the exact inbox the link was sent to; consuming it verifies THAT address only
  sent_to_email   text not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  invalidated_at  timestamptz,
  created_at      timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists quote_review_tokens_order_idx on public.quote_review_tokens (order_id) where consumed_at is null and invalidated_at is null;
alter table public.quote_review_tokens enable row level security;
-- no policies: only the app server (service role, through the functions below) touches tokens
revoke all on public.quote_review_tokens from anon, authenticated;

-- Issues a review token for the order's CURRENT shop quotation. Only the hash is
-- stored; the raw token is generated and emailed by the server. Any earlier
-- open token for the order is invalidated (one live link per order).
create or replace function public.issue_quote_review_token(
  p_order_id uuid, p_revision_id uuid, p_token_hash text, p_ttl_hours int default 72)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_rev   public.order_specification_revisions%rowtype;
  v_id    uuid;
  v_exp   timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_ttl_hours, 72), 1), 336));
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;
  if v_order.has_no_email or v_order.customer_email is null then
    raise exception 'VALIDATION: this order has no customer email (walk-in / paper slip only)' using errcode = 'P0001';
  end if;
  select * into v_rev from public.order_specification_revisions where revision_id = p_revision_id and order_id = p_order_id;
  if not found or v_rev.revision_number <> v_order.current_revision or v_rev.revision_type not in ('staff_draft', 'revised_quote') then
    raise exception 'STALE_REVISION: a review link can only be issued for the current shop quotation' using errcode = 'P0001';
  end if;
  update public.quote_review_tokens set invalidated_at = now()
  where order_id = p_order_id and consumed_at is null and invalidated_at is null;
  insert into public.quote_review_tokens (order_id, revision_id, token_hash, sent_to_email, expires_at)
  values (p_order_id, p_revision_id, lower(p_token_hash), v_order.customer_email, v_exp)
  returning token_id into v_id;
  return jsonb_build_object('token_id', v_id, 'expires_at', v_exp, 'sent_to_email', v_order.customer_email);
end;
$$;

-- Atomically consumes a review token (row-locked: a second concurrent attempt
-- waits, then finds it consumed). On success the order's email ownership is
-- verified (only if the link was sent to the order's current email) and the
-- caller gets the ONE order_id + revision_id the review session may access.
create or replace function public.consume_quote_review_token(p_token_hash text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tok   public.quote_review_tokens%rowtype;
  v_order public.orders%rowtype;
  v_rev   public.order_specification_revisions%rowtype;
begin
  select * into v_tok from public.quote_review_tokens where token_hash = lower(p_token_hash) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_tok.consumed_at is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if v_tok.invalidated_at is not null then return jsonb_build_object('ok', false, 'reason', 'replaced'); end if;
  if now() > v_tok.expires_at then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;

  select * into v_order from public.orders where id = v_tok.order_id for update;
  select * into v_rev from public.order_specification_revisions where revision_id = v_tok.revision_id;
  if v_order.customer_email is distinct from v_tok.sent_to_email then
    update public.quote_review_tokens set invalidated_at = now() where token_id = v_tok.token_id;
    return jsonb_build_object('ok', false, 'reason', 'email_changed');
  end if;
  if v_rev.revision_number <> v_order.current_revision then
    update public.quote_review_tokens set invalidated_at = now() where token_id = v_tok.token_id;
    return jsonb_build_object('ok', false, 'reason', 'replaced');
  end if;

  update public.quote_review_tokens set consumed_at = now() where token_id = v_tok.token_id;
  update public.orders set email_verified_at = coalesce(email_verified_at, now()) where id = v_order.id;
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'revision_id', v_tok.revision_id,
                            'revision_number', v_rev.revision_number, 'email', v_tok.sent_to_email);
end;
$$;

-- Links an order to a customer account. Idempotent; refuses unless the order's
-- email was verified AND equals the account's email. Never changes passwords.
create or replace function public.link_customer_account(p_order_id uuid, p_user_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_profile public.profiles%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;
  select * into v_profile from public.profiles where id = p_user_id;
  if not found or v_profile.role <> 'customer' or not v_profile.is_active then
    raise exception 'FORBIDDEN: not an active customer account' using errcode = '42501';
  end if;
  if v_order.email_verified_at is null then
    raise exception 'FORBIDDEN: email ownership has not been verified for this order' using errcode = '42501';
  end if;
  if lower(trim(v_profile.email)) <> v_order.customer_email then
    raise exception 'FORBIDDEN: account email does not match the verified order email' using errcode = '42501';
  end if;
  if v_order.customer_user_id = p_user_id then
    return jsonb_build_object('linked', true, 'already', true);
  end if;
  if v_order.customer_user_id is not null then
    raise exception 'FORBIDDEN: order is linked to another account' using errcode = '42501';
  end if;
  update public.orders set customer_user_id = p_user_id, provisioning_status = 'linked' where id = p_order_id;
  return jsonb_build_object('linked', true, 'already', false);
end;
$$;

revoke all on function public.issue_quote_review_token(uuid, uuid, text, int) from public, anon, authenticated;
revoke all on function public.consume_quote_review_token(text) from public, anon, authenticated;
revoke all on function public.link_customer_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_quote_review_token(uuid, uuid, text, int) to service_role;
grant execute on function public.consume_quote_review_token(text) to service_role;
grant execute on function public.link_customer_account(uuid, uuid) to service_role;
revoke all on function private.orders_email_guard() from public;
