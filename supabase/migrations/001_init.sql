-- =============================================================================
-- JJ Furniture Shop & Enterprises — Hybrid Order Monitoring System (OMS)
-- Migration 001: schema, business-rule triggers, RLS policies, customer RPCs
-- Target: Supabase Postgres 15+
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Helper functions live in a schema that PostgREST does not expose.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'staff', 'craftsman', 'driver');

create type public.municipality as enum
  ('Valencia City', 'Lantapan', 'Cabanglasan', 'Pangantucan', 'San Fernando', 'Other');

create type public.wood_type as enum ('Mahogany', 'Gmelina', 'Other');

create type public.order_status as enum (
  'Waiting for Confirmation',
  'Confirmed',
  'In Production',
  'Completed / For Inspection',
  'Ready for Delivery',
  'Out for Delivery',
  'Delivered'
);

create type public.priority_label as enum ('Urgent', 'High', 'Normal');

create type public.payment_exception_type as enum
  ('Standard 30/70', 'Installment', 'Credit / Pay Later');

create type public.confirmation_method as enum
  ('Signed Paper Slip', 'Messenger Reply', 'Customer Portal PIN');

create type public.payment_type as enum
  ('Down Payment (30%)', 'Delivery Balance Collection', 'Installment / Partial', 'Delivery Fee');

create type public.payment_method as enum ('Cash', 'GCash / Bank Transfer');

create type public.vehicle_type as enum ('Multicab', 'Elf Truck');

create type public.dispatch_status as enum
  ('Scheduled', 'Out for Delivery', 'Delivered', 'Failed / Reschedule');

create type public.exception_category as enum (
  'Installment Approval',
  'Credit / Unpaid Balance',
  'Special Delivery Terms',
  'Spec Clarification',
  'On-Site Scratch Touch-Up / Repair'
);

create type public.exception_status as enum ('Pending', 'Approved', 'Rejected', 'Resolved');

create type public.notification_channel as enum ('SMS', 'Messenger', 'In-App');

create type public.notification_status as enum ('Sent', 'Failed', 'Pending');

-- ---------------------------------------------------------------------------
-- 1. PROFILES
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  role        public.app_role not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role) where is_active;

-- ---------------------------------------------------------------------------
-- 2. ORDERS
-- ---------------------------------------------------------------------------
create table public.orders (
  id                           uuid primary key default gen_random_uuid(),
  order_code                   text not null unique check (order_code ~ '^(JJ-\d{4}-\d{4}|DR-\d{4})$'),
  paper_slip_number            text not null unique check (length(trim(paper_slip_number)) > 0),
  encoded_by_id                uuid references public.profiles (id),
  customer_name                text not null check (length(trim(customer_name)) > 0),
  customer_phone               text not null check (length(trim(customer_phone)) > 0),
  delivery_address             text not null check (length(trim(delivery_address)) > 0),
  municipality                 public.municipality not null,
  pin_code_hash                text not null,
  pin_code_display             text check (pin_code_display ~ '^\d{4}$'),
  item_name                    text not null check (length(trim(item_name)) > 0),
  quantity                     int not null check (quantity > 0),
  dimensions                   text not null check (length(trim(dimensions)) > 0),
  wood_type                    public.wood_type not null,
  color_finish                 text not null check (length(trim(color_finish)) > 0),
  special_instructions         text,
  reference_photo_url          text,
  specs_confirmed              boolean not null default false,
  status                       public.order_status not null default 'Waiting for Confirmation',
  priority_rank                int not null default 99 check (priority_rank > 0),
  priority_label               public.priority_label not null default 'Normal',
  assigned_craftsman_id        uuid references public.profiles (id),
  furniture_price              numeric(10,2) not null check (furniture_price > 0),
  standard_down_payment_due    numeric(10,2),
  remaining_furniture_balance  numeric(10,2),
  delivery_fee                 numeric(10,2) not null default 0.00 check (delivery_fee >= 0),
  collectible_on_delivery      numeric(10,2),
  payment_exception_type       public.payment_exception_type not null default 'Standard 30/70',
  payment_exception_approved   boolean not null default false,
  estimated_completion_date    date not null,
  scheduled_delivery_date      date,
  version                      int not null default 1,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  -- HARD GATE: nothing past "Waiting for Confirmation" without confirmed specs.
  constraint orders_specs_gate check (status = 'Waiting for Confirmation' or specs_confirmed)
);
create index orders_status_idx on public.orders (status);
create index orders_priority_idx on public.orders (priority_rank, created_at) where status <> 'Delivered';
create index orders_encoded_by_idx on public.orders (encoded_by_id);
create index orders_craftsman_idx on public.orders (assigned_craftsman_id);

-- ---------------------------------------------------------------------------
-- 3. ORDER CONFIRMATIONS
-- ---------------------------------------------------------------------------
create table public.order_confirmations (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid not null references public.orders (id) on delete cascade,
  version_number            int not null default 1 check (version_number > 0),
  confirmed_specs_snapshot  jsonb not null,
  confirmation_method       public.confirmation_method not null,
  confirmed_by_name         text not null,
  recorded_by_staff_id      uuid references public.profiles (id),
  confirmed_at              timestamptz not null default now(),
  unique (order_id, version_number)
);
create index order_confirmations_staff_idx on public.order_confirmations (recorded_by_staff_id);

-- ---------------------------------------------------------------------------
-- 4. PAYMENTS
-- ---------------------------------------------------------------------------
create table public.payments (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null references public.orders (id) on delete cascade,
  client_transaction_id       uuid not null unique,
  payment_type                public.payment_type not null,
  amount                      numeric(10,2) not null check (amount > 0),
  payment_method              public.payment_method not null,
  collected_by_id             uuid references public.profiles (id),
  verified_by_owner_or_staff  boolean not null default false,
  notes                       text,
  paid_at                     timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create index payments_collector_idx on public.payments (collected_by_id);
create index payments_unverified_idx on public.payments (order_id) where not verified_by_owner_or_staff;

-- ---------------------------------------------------------------------------
-- 5. ORDER STATUS HISTORY
-- ---------------------------------------------------------------------------
create table public.order_status_history (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id) on delete cascade,
  from_status            text,
  to_status              text not null,
  changed_by_id          uuid references public.profiles (id),
  notes                  text,
  -- idempotency key for offline driver actions (null for online actions)
  client_transaction_id  uuid unique,
  changed_at             timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, changed_at desc);
create index order_status_history_changed_by_idx on public.order_status_history (changed_by_id);

-- ---------------------------------------------------------------------------
-- 6. DELIVERY ASSIGNMENTS
-- ---------------------------------------------------------------------------
create table public.delivery_assignments (
  id                           uuid primary key default gen_random_uuid(),
  order_id                     uuid not null references public.orders (id) on delete cascade,
  driver_id                    uuid not null references public.profiles (id),
  vehicle_type                 public.vehicle_type not null,
  scheduled_date               date not null,
  time_window                  text,
  delivery_fee                 numeric(10,2) not null check (delivery_fee >= 0),
  expected_collectible_amount  numeric(10,2) not null check (expected_collectible_amount >= 0),
  dispatch_status              public.dispatch_status not null default 'Scheduled',
  failure_or_damage_notes      text,
  updated_at                   timestamptz not null default now()
);
create index delivery_assignments_order_idx on public.delivery_assignments (order_id);
create index delivery_assignments_driver_idx on public.delivery_assignments (driver_id, scheduled_date);
-- one live (not failed) assignment per order
create unique index delivery_assignments_one_active
  on public.delivery_assignments (order_id) where dispatch_status <> 'Failed / Reschedule';

-- ---------------------------------------------------------------------------
-- 7. ORDER EXCEPTIONS & REPAIRS
-- ---------------------------------------------------------------------------
create table public.order_exceptions_and_repairs (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  category        public.exception_category not null,
  description     text not null check (length(trim(description)) > 0),
  requested_by    text,
  status          public.exception_status not null default 'Pending',
  resolved_by_id  uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index exceptions_order_idx on public.order_exceptions_and_repairs (order_id);
create index exceptions_pending_idx on public.order_exceptions_and_repairs (created_at) where status = 'Pending';
create index exceptions_resolved_by_idx on public.order_exceptions_and_repairs (resolved_by_id);

-- ---------------------------------------------------------------------------
-- 8. NOTIFICATIONS
-- ---------------------------------------------------------------------------
create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  recipient_phone  text,
  channel          public.notification_channel not null default 'SMS',
  message_body     text not null,
  delivery_status  public.notification_status not null default 'Pending',
  created_at       timestamptz not null default now()
);
create index notifications_order_idx on public.notifications (order_id);
create index notifications_failed_idx on public.notifications (created_at) where delivery_status = 'Failed';

-- ---------------------------------------------------------------------------
-- Auxiliary security table: rate limiting for customer PIN checks.
-- (Not exposed to any API role; only the SECURITY DEFINER RPC touches it.)
-- ---------------------------------------------------------------------------
create table public.customer_pin_attempts (
  id            bigint generated always as identity primary key,
  order_code    text not null,
  client_key    text not null,
  succeeded     boolean not null,
  attempted_at  timestamptz not null default now()
);
create index customer_pin_attempts_lookup_idx
  on public.customer_pin_attempts (order_code, client_key, attempted_at desc);

-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================
create or replace function private.app_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_office()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.app_role()) in ('owner', 'staff'), false)
$$;

create or replace function private.is_assigned_driver(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.delivery_assignments d
    where d.order_id = p_order_id and d.driver_id = (select auth.uid())
  ) and (select private.app_role()) = 'driver'
$$;

grant execute on function private.app_role(), private.is_office(), private.is_assigned_driver(uuid)
  to authenticated, service_role;

-- Allowed forward/back transitions of the 7-stage machine.
create or replace function private.is_valid_transition(p_from public.order_status, p_to public.order_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_from = p_to or (p_from, p_to) in (
    ('Waiting for Confirmation'::public.order_status, 'Confirmed'::public.order_status),
    ('Confirmed', 'Waiting for Confirmation'),            -- specs revised, re-confirm
    ('Confirmed', 'In Production'),
    ('In Production', 'Completed / For Inspection'),
    ('Completed / For Inspection', 'Ready for Delivery'), -- owner inspection passed
    ('Completed / For Inspection', 'In Production'),      -- inspection failed: revision
    ('Ready for Delivery', 'Out for Delivery'),
    ('Out for Delivery', 'Delivered'),
    ('Out for Delivery', 'Ready for Delivery')            -- failed delivery: reschedule
  )
$$;
grant execute on function private.is_valid_transition(public.order_status, public.order_status)
  to authenticated, service_role;

-- =============================================================================
-- ORDERS TRIGGER: financial engine + state machine + optimistic version
-- =============================================================================
create or replace function private.orders_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_furniture_paid numeric(10,2);
  v_fee_paid       numeric(10,2);
  v_overflow       numeric(10,2);
  v_role           public.app_role := (select private.app_role());
begin
  -- Valencia City deliveries are always free.
  if new.municipality = 'Valencia City' then
    new.delivery_fee := 0;
  end if;

  select
    coalesce(sum(amount) filter (where payment_type <> 'Delivery Fee'), 0),
    coalesce(sum(amount) filter (where payment_type = 'Delivery Fee'), 0)
  into v_furniture_paid, v_fee_paid
  from public.payments
  where order_id = new.id and verified_by_owner_or_staff;

  new.standard_down_payment_due   := round(new.furniture_price * 0.30, 2);
  new.remaining_furniture_balance := greatest(0, new.furniture_price - v_furniture_paid);
  v_overflow                      := greatest(0, v_furniture_paid - new.furniture_price);
  new.collectible_on_delivery     := new.remaining_furniture_balance
                                     + greatest(0, new.delivery_fee - v_fee_paid - v_overflow);

  if tg_op = 'INSERT' then
    if new.status <> 'Waiting for Confirmation' and not new.specs_confirmed then
      raise exception 'SPECS_NOT_CONFIRMED: order % cannot start at % before customer confirms specs',
        new.order_code, new.status using errcode = 'P0001';
    end if;
    new.version := 1;
    return new;
  end if;

  -- UPDATE ------------------------------------------------------------------
  if new.status is distinct from old.status then
    if not private.is_valid_transition(old.status, new.status) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('Confirmed', 'In Production') and not new.specs_confirmed then
      raise exception 'SPECS_NOT_CONFIRMED: customer must confirm specifications first'
        using errcode = 'P0001';
    end if;
    if new.status = 'Out for Delivery'
       and v_furniture_paid < new.standard_down_payment_due
       and not new.payment_exception_approved then
      raise exception 'DOWN_PAYMENT_REQUIRED: 30%% down payment or an owner-approved exception is required before dispatch'
        using errcode = 'P0001';
    end if;
    -- Inspection outcome is an owner decision (authenticated callers only;
    -- service-role calls are authorised in the application layer).
    if old.status = 'Completed / For Inspection' and v_role is not null and v_role <> 'owner' then
      raise exception 'OWNER_ONLY: only the owner can pass or fail an inspection' using errcode = '42501';
    end if;
  end if;

  if new.payment_exception_approved and not old.payment_exception_approved
     and v_role is not null and v_role <> 'owner' then
    raise exception 'OWNER_ONLY: payment exceptions require owner approval' using errcode = '42501';
  end if;

  if (new.priority_rank is distinct from old.priority_rank
      or new.priority_label is distinct from old.priority_label)
     and v_role is not null and v_role <> 'owner' then
    raise exception 'OWNER_ONLY: only the owner sets production priority' using errcode = '42501';
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_before_write
  before insert or update on public.orders
  for each row execute function private.orders_before_write();

-- Recompute order balances whenever a payment changes.
create or replace function private.payments_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set updated_at = now()
  where id = coalesce(new.order_id, old.order_id);
  return null;
end;
$$;

create trigger payments_after_change
  after insert or update or delete on public.payments
  for each row execute function private.payments_after_change();

-- Installment / Credit orders automatically queue an owner approval.
create or replace function private.orders_exception_gate()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.payment_exception_type <> 'Standard 30/70'
     and not new.payment_exception_approved
     and (tg_op = 'INSERT' or old.payment_exception_type is distinct from new.payment_exception_type)
     and not exists (
       select 1 from public.order_exceptions_and_repairs e
       where e.order_id = new.id and e.status = 'Pending'
         and e.category in ('Installment Approval', 'Credit / Unpaid Balance')
     ) then
    insert into public.order_exceptions_and_repairs (order_id, category, description, requested_by)
    values (
      new.id,
      case when new.payment_exception_type = 'Installment'
           then 'Installment Approval'::public.exception_category
           else 'Credit / Unpaid Balance'::public.exception_category end,
      format('%s requested for %s (%s). Owner approval required.',
             new.payment_exception_type, new.order_code, new.customer_name),
      'System (payment terms)'
    );
  end if;
  return null;
end;
$$;

create trigger orders_exception_gate
  after insert or update of payment_exception_type on public.orders
  for each row execute function private.orders_exception_gate();

-- Owner-only decisions on financial exceptions.
create or replace function private.exceptions_before_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.app_role := (select private.app_role());
begin
  if new.status is distinct from old.status
     and new.status in ('Approved', 'Rejected')
     and new.category in ('Installment Approval', 'Credit / Unpaid Balance', 'Special Delivery Terms')
     and v_role is not null and v_role <> 'owner' then
    raise exception 'OWNER_ONLY: only the owner can approve or reject payment exceptions'
      using errcode = '42501';
  end if;
  if new.status <> 'Pending' and old.status = 'Pending' then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

create trigger exceptions_before_update
  before update on public.order_exceptions_and_repairs
  for each row execute function private.exceptions_before_update();

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

create trigger delivery_assignments_touch
  before update on public.delivery_assignments
  for each row execute function private.touch_updated_at();

-- =============================================================================
-- WORKSHOP VIEW — the only order surface craftsmen can read. No money columns.
-- =============================================================================
create view public.workshop_orders
with (security_barrier = true)
as
select
  o.id, o.order_code, o.item_name, o.quantity, o.dimensions, o.wood_type, o.color_finish,
  o.special_instructions, o.reference_photo_url, o.status, o.priority_rank, o.priority_label,
  o.assigned_craftsman_id, o.estimated_completion_date, o.version, o.updated_at,
  exists (
    select 1 from public.order_status_history h
    where h.order_id = o.id
      and h.from_status = 'Completed / For Inspection' and h.to_status = 'In Production'
      and h.changed_at = (select max(h2.changed_at) from public.order_status_history h2 where h2.order_id = o.id)
  ) as needs_revision
from public.orders o
where o.status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')
  and (select private.app_role()) in ('craftsman', 'owner', 'staff');

revoke all on public.workshop_orders from anon;
grant select on public.workshop_orders to authenticated;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.profiles                      enable row level security;
alter table public.orders                        enable row level security;
alter table public.order_confirmations           enable row level security;
alter table public.payments                      enable row level security;
alter table public.order_status_history          enable row level security;
alter table public.delivery_assignments          enable row level security;
alter table public.order_exceptions_and_repairs  enable row level security;
alter table public.notifications                 enable row level security;
alter table public.customer_pin_attempts         enable row level security;

-- Customers never touch tables directly.
revoke all on all tables in schema public from anon;

-- profiles ------------------------------------------------------------------
create policy profiles_select_staff on public.profiles for select to authenticated
  using ((select private.app_role()) is not null);
create policy profiles_owner_write on public.profiles for all to authenticated
  using ((select private.app_role()) = 'owner')
  with check ((select private.app_role()) = 'owner');

-- orders --------------------------------------------------------------------
-- Craftsmen have NO policy here: they read public.workshop_orders only.
create policy orders_select_office on public.orders for select to authenticated
  using ((select private.is_office()));
create policy orders_select_driver on public.orders for select to authenticated
  using ((select private.is_assigned_driver(id)));
create policy orders_insert_office on public.orders for insert to authenticated
  with check ((select private.is_office()));
create policy orders_update_office on public.orders for update to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));
create policy orders_update_driver on public.orders for update to authenticated
  using ((select private.is_assigned_driver(id)))
  with check (status in ('Out for Delivery', 'Delivered', 'Ready for Delivery'));
create policy orders_delete_owner on public.orders for delete to authenticated
  using ((select private.app_role()) = 'owner');

-- order_confirmations -------------------------------------------------------
create policy confirmations_office on public.order_confirmations for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));

-- payments ------------------------------------------------------------------
create policy payments_office on public.payments for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));
create policy payments_driver_select on public.payments for select to authenticated
  using (collected_by_id = (select auth.uid()) and (select private.is_assigned_driver(order_id)));
create policy payments_driver_insert on public.payments for insert to authenticated
  with check (
    collected_by_id = (select auth.uid())
    and not verified_by_owner_or_staff          -- cash is verified at handover
    and (select private.is_assigned_driver(order_id))
  );

-- order_status_history ------------------------------------------------------
create policy history_office on public.order_status_history for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));
create policy history_driver_select on public.order_status_history for select to authenticated
  using ((select private.is_assigned_driver(order_id)));
create policy history_insert_field on public.order_status_history for insert to authenticated
  with check (
    changed_by_id = (select auth.uid())
    and (select private.app_role()) in ('craftsman', 'driver')
  );
create policy history_craftsman_select on public.order_status_history for select to authenticated
  using ((select private.app_role()) = 'craftsman');

-- delivery_assignments ------------------------------------------------------
create policy deliveries_office on public.delivery_assignments for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));
create policy deliveries_driver_select on public.delivery_assignments for select to authenticated
  using (driver_id = (select auth.uid()));
create policy deliveries_driver_update on public.delivery_assignments for update to authenticated
  using (driver_id = (select auth.uid())) with check (driver_id = (select auth.uid()));

-- order_exceptions_and_repairs ----------------------------------------------
create policy exceptions_office on public.order_exceptions_and_repairs for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));
create policy exceptions_craftsman on public.order_exceptions_and_repairs for select to authenticated
  using ((select private.app_role()) = 'craftsman' and category = 'Spec Clarification');
create policy exceptions_craftsman_insert on public.order_exceptions_and_repairs for insert to authenticated
  with check ((select private.app_role()) = 'craftsman' and category = 'Spec Clarification' and status = 'Pending');
create policy exceptions_driver on public.order_exceptions_and_repairs for select to authenticated
  using ((select private.is_assigned_driver(order_id)) and category = 'On-Site Scratch Touch-Up / Repair');
create policy exceptions_driver_insert on public.order_exceptions_and_repairs for insert to authenticated
  with check ((select private.is_assigned_driver(order_id))
              and category = 'On-Site Scratch Touch-Up / Repair' and status = 'Pending');

-- notifications -------------------------------------------------------------
create policy notifications_office on public.notifications for all to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));

-- customer_pin_attempts: no policies => no API access at all.

-- =============================================================================
-- CUSTOMER RPCs (anon-callable, SECURITY DEFINER, privacy-scoped)
-- =============================================================================

-- Order ID only: stage + the two separate dates. Nothing personal or financial.
create or replace function public.customer_track(p_order_code text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'order_code', o.order_code,
    'item_name', o.item_name,
    'status', o.status,
    'estimated_completion_date', o.estimated_completion_date,
    'scheduled_delivery_date', o.scheduled_delivery_date,
    'updated_at', o.updated_at
  )
  from public.orders o
  where o.order_code = upper(trim(p_order_code))
$$;

-- Order ID + PIN: verifies against the bcrypt hash with rate limiting.
-- Returns {ok, order_id?, locked?, remaining_attempts?}
create or replace function public.customer_verify_pin(p_order_code text, p_pin text, p_client_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code      text := upper(trim(p_order_code));
  v_failures  int;
  v_order     public.orders%rowtype;
  v_ok        boolean;
  c_max       constant int := 5;
begin
  select count(*) into v_failures
  from public.customer_pin_attempts a
  where a.order_code = v_code and a.client_key = p_client_key
    and not a.succeeded and a.attempted_at > now() - interval '15 minutes';

  if v_failures >= c_max then
    return jsonb_build_object('ok', false, 'locked', true, 'remaining_attempts', 0);
  end if;

  select * into v_order from public.orders o where o.order_code = v_code;
  v_ok := found and p_pin ~ '^\d{4}$'
          and v_order.pin_code_hash = extensions.crypt(p_pin, v_order.pin_code_hash);

  insert into public.customer_pin_attempts (order_code, client_key, succeeded)
  values (v_code, p_client_key, coalesce(v_ok, false));

  if v_ok then
    return jsonb_build_object('ok', true, 'order_id', v_order.id);
  end if;
  return jsonb_build_object('ok', false, 'locked', v_failures + 1 >= c_max,
                            'remaining_attempts', greatest(0, c_max - v_failures - 1));
end;
$$;

revoke all on function public.customer_track(text) from public;
revoke all on function public.customer_verify_pin(text, text, text) from public;
grant execute on function public.customer_track(text) to anon, authenticated, service_role;
grant execute on function public.customer_verify_pin(text, text, text) to anon, authenticated, service_role;
