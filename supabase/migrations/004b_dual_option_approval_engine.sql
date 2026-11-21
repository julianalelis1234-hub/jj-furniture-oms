-- =============================================================================
-- Migration 004b: dual-option ordering + database-hardened approval engine.
--
--  * Option 2 customer self-service requests ('Quote Requested', no price,
--    no paper slip yet) next to Option 1 staff intake.
--  * Quotations with an expiry (quoted_at / expires_at).
--  * accept_order_revision(): one atomic, row-locked, idempotent acceptance of
--    the exact specification AND quotation (two explicit timestamps).
--  * Production gate: Confirmed -> In Production needs a verified 30% down
--    payment (or an owner-approved credit/installment exception) and no
--    unresolved production-blocking exceptions.
--  * Role-checked state machine, append-only revisions / confirmations and an
--    audit-safe payments ledger (BEFORE UPDATE OR DELETE triggers).
--
-- Data-preserving: no rows are deleted, no data columns dropped. Breaking
-- interface changes (rename revisions.id -> revision_id, replace
-- confirm_spec_revision with accept_order_revision) require the matching app
-- code from the same branch.
-- =============================================================================

-- ------------------------------------------------ orders: Option 2 columns ----
alter table public.orders alter column furniture_price drop not null;
alter table public.orders alter column paper_slip_number drop not null;
alter table public.orders alter column estimated_completion_date drop not null;

alter table public.orders
  add column if not exists order_origin text not null default 'staff_intake',
  add column if not exists client_request_key text;

do $$ begin
  alter table public.orders add constraint orders_origin_check
    check (order_origin in ('staff_intake', 'customer_self_service'));
  -- Everything past the intake state needs an official quote and a paper slip.
  alter table public.orders add constraint orders_quote_fields_required check (
    status = 'Quote Requested'
    or (furniture_price is not null and paper_slip_number is not null and estimated_completion_date is not null)
  );
  alter table public.orders add constraint orders_quote_requested_origin check (
    status <> 'Quote Requested' or (order_origin = 'customer_self_service' and not specs_confirmed)
  );
exception when duplicate_object then null; end $$;

create unique index if not exists orders_client_request_key_uidx
  on public.orders (client_request_key) where client_request_key is not null;

alter table public.orders drop constraint if exists orders_specs_gate;
alter table public.orders add constraint orders_specs_gate
  check (status in ('Quote Requested', 'Waiting for Confirmation') or specs_confirmed);

update public.orders set current_revision = 1 where current_revision is null;
alter table public.orders alter column current_revision set default 1;
alter table public.orders alter column current_revision set not null;

-- ------------------------------------- revisions: revision_id + quotation ----
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'order_specification_revisions' and column_name = 'id') then
    alter table public.order_specification_revisions rename column id to revision_id;
  end if;
end $$;

alter table public.order_specification_revisions
  add column if not exists quoted_at  timestamptz,
  add column if not exists expires_at timestamptz;
alter table public.order_specification_revisions alter column quoted_furniture_price drop not null;
alter table public.order_specification_revisions alter column quoted_delivery_fee drop not null;

-- Backfill: existing shop quotes were issued when they were saved; standard 7-day validity.
-- (Immutability trigger is (re)created below, after this one-time backfill.)
drop trigger if exists spec_revisions_immutable on public.order_specification_revisions;
update public.order_specification_revisions
set quoted_at = created_at, expires_at = created_at + interval '7 days'
where revision_type in ('staff_draft', 'revised_quote') and quoted_at is null;

do $$ begin
  alter table public.order_specification_revisions add constraint spec_revisions_quote_fields check (
    revision_type not in ('staff_draft', 'revised_quote')
    or (quoted_furniture_price is not null and quoted_delivery_fee is not null
        and quoted_at is not null and expires_at is not null and expires_at > quoted_at)
  );
exception when duplicate_object then null; end $$;

-- ------------------------------ order_confirmations: explicit acceptance ----
alter table public.order_confirmations
  add column if not exists specification_accepted_at timestamptz,
  add column if not exists quotation_accepted_at     timestamptz,
  add column if not exists accepted_furniture_price  numeric(10,2),
  add column if not exists accepted_delivery_fee     numeric(10,2),
  add column if not exists accepted_total_amount     numeric(10,2),
  add column if not exists client_idempotency_key    text;

drop trigger if exists order_confirmations_immutable on public.order_confirmations;
update public.order_confirmations c set
  specification_accepted_at = coalesce(c.specification_accepted_at, c.confirmed_at),
  quotation_accepted_at     = coalesce(c.quotation_accepted_at, c.confirmed_at),
  accepted_furniture_price  = coalesce(c.accepted_furniture_price, r.quoted_furniture_price),
  accepted_delivery_fee     = coalesce(c.accepted_delivery_fee, r.quoted_delivery_fee),
  accepted_total_amount     = coalesce(c.accepted_total_amount, r.quoted_furniture_price + r.quoted_delivery_fee)
from public.order_specification_revisions r
where r.revision_id = c.revision_id;

alter table public.order_confirmations alter column specification_accepted_at set not null;
alter table public.order_confirmations alter column quotation_accepted_at set not null;
do $$ begin
  if not exists (select 1 from public.order_confirmations where revision_id is null or revision_number is null) then
    alter table public.order_confirmations alter column revision_id set not null;
    alter table public.order_confirmations alter column revision_number set not null;
  else
    raise notice 'order_confirmations.revision_id left nullable: some legacy confirmations are not linked to a revision';
  end if;
end $$;
create unique index if not exists order_confirmations_idempotency_uidx
  on public.order_confirmations (order_id, client_idempotency_key) where client_idempotency_key is not null;

-- ------------------------------------- exceptions: production-blocking flag ----
alter table public.order_exceptions_and_repairs
  add column if not exists is_production_blocking boolean not null default false;
update public.order_exceptions_and_repairs set is_production_blocking = true
where category = 'Spec Clarification' and not is_production_blocking;

create or replace function private.exceptions_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- an open specification question always blocks confirmation and production
  if new.category = 'Spec Clarification' then new.is_production_blocking := true; end if;
  return new;
end; $$;
drop trigger if exists exceptions_before_insert on public.order_exceptions_and_repairs;
create trigger exceptions_before_insert
  before insert on public.order_exceptions_and_repairs
  for each row execute function private.exceptions_before_insert();

-- ------------------------------------------------ append-only audit tables ----
-- Rows may disappear only through the cascade when the parent order itself is
-- deleted (the order row is already gone when the cascade runs).
create or replace function private.append_only_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.orders o where o.id = old.order_id) then
      raise exception 'IMMUTABLE_RECORD: % rows are append-only and cannot be deleted', tg_table_name using errcode = '42501';
    end if;
    return old;
  end if;
  raise exception 'IMMUTABLE_RECORD: % rows are append-only and cannot be changed', tg_table_name using errcode = '42501';
end; $$;

drop trigger if exists spec_revisions_immutable on public.order_specification_revisions;
create trigger spec_revisions_immutable
  before update or delete on public.order_specification_revisions
  for each row execute function private.append_only_guard();

create trigger order_confirmations_immutable
  before update or delete on public.order_confirmations
  for each row execute function private.append_only_guard();

-- Payments: an auditable ledger. Only verification (false -> true) and an
-- appended note may change after insert; amounts, types and links never do.
create or replace function private.payments_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.orders o where o.id = old.order_id) then
      raise exception 'IMMUTABLE_RECORD: payments cannot be deleted; record a correcting entry instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.order_id is distinct from old.order_id or new.client_transaction_id is distinct from old.client_transaction_id
     or new.payment_type is distinct from old.payment_type or new.amount is distinct from old.amount
     or new.payment_method is distinct from old.payment_method or new.collected_by_id is distinct from old.collected_by_id
     or new.paid_at is distinct from old.paid_at
     or (old.verified_by_owner_or_staff and not new.verified_by_owner_or_staff)
     or (old.notes is not null and (new.notes is null or left(new.notes, length(old.notes)) <> old.notes)) then
    raise exception 'IMMUTABLE_RECORD: only verification and appended notes may change on a payment' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before update or delete on public.payments
  for each row execute function private.payments_guard();

-- Confirmations are written only by accept_order_revision(); office reads them.
drop policy if exists confirmations_office on public.order_confirmations;
drop policy if exists confirmations_office_select on public.order_confirmations;
create policy confirmations_office_select on public.order_confirmations for select to authenticated
  using ((select private.is_office()));

-- ---------------------------------------------------------- state machine ----
create or replace function private.is_valid_transition(p_from public.order_status, p_to public.order_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_from = p_to or (p_from, p_to) in (
    ('Quote Requested'::public.order_status, 'Waiting for Confirmation'::public.order_status), -- official quote issued
    ('Waiting for Confirmation', 'Confirmed'),
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

-- Which signed-in roles may request a transition (service_role / app server
-- calls have no JWT role and are authorized in the application layer first).
create or replace function private.role_may_transition(p_role public.app_role, p_from public.order_status, p_to public.order_status)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_role = 'craftsman' then p_from = 'In Production' and p_to = 'Completed / For Inspection'
    when p_role = 'driver' then (p_from, p_to) in (
      ('Ready for Delivery'::public.order_status, 'Out for Delivery'::public.order_status),
      ('Out for Delivery', 'Delivered'), ('Out for Delivery', 'Ready for Delivery'))
    when p_role = 'staff' then p_from <> 'Completed / For Inspection'
    when p_role = 'owner' then true
    else false end
$$;

create or replace function private.orders_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_furniture_paid numeric(10,2);
  v_fee_paid       numeric(10,2);
  v_overflow       numeric(10,2);
  v_price          numeric(10,2);
  v_role           public.app_role := (select private.app_role());
  v_rev            public.order_specification_revisions%rowtype;
  v_spec_changed   boolean := false;
begin
  if new.municipality = 'Valencia City' then
    new.delivery_fee := 0;
  end if;

  select
    coalesce(sum(amount) filter (where payment_type <> 'Delivery Fee'), 0),
    coalesce(sum(amount) filter (where payment_type = 'Delivery Fee'), 0)
  into v_furniture_paid, v_fee_paid
  from public.payments
  where order_id = new.id and verified_by_owner_or_staff;

  -- server-side money: 30% down payment, balance and collectible (centavo rounding)
  v_price                         := coalesce(new.furniture_price, 0);
  new.standard_down_payment_due   := round(v_price * 0.30, 2);
  new.remaining_furniture_balance := greatest(0, round(v_price - v_furniture_paid, 2));
  v_overflow                      := greatest(0, v_furniture_paid - v_price);
  new.collectible_on_delivery     := round(new.remaining_furniture_balance
                                     + greatest(0, new.delivery_fee - v_fee_paid - v_overflow), 2);

  if tg_op = 'INSERT' then
    if new.status not in ('Quote Requested', 'Waiting for Confirmation') and not new.specs_confirmed then
      raise exception 'SPECS_NOT_CONFIRMED: order % cannot start at % before customer confirms specs',
        new.order_code, new.status using errcode = 'P0001';
    end if;
    new.version := 1;
    return new;
  end if;

  -- Specification / quote edits -----------------------------------------
  v_spec_changed :=
       new.furniture_category is distinct from old.furniture_category
    or new.design_variant     is distinct from old.design_variant
    or new.width_cm           is distinct from old.width_cm
    or new.height_cm          is distinct from old.height_cm
    or new.depth_cm           is distinct from old.depth_cm
    or new.wood_type          is distinct from old.wood_type
    or new.custom_wood_note   is distinct from old.custom_wood_note
    or new.color_finish       is distinct from old.color_finish
    or new.quantity           is distinct from old.quantity
    or new.furniture_price    is distinct from old.furniture_price
    or new.delivery_fee       is distinct from old.delivery_fee;
  if v_spec_changed then
    if old.status not in ('Quote Requested', 'Waiting for Confirmation') and new.status not in ('Waiting for Confirmation') then
      raise exception 'SPEC_LOCKED: specifications and quote are locked once confirmed; use a change request'
        using errcode = 'P0001';
    end if;
    -- any price, fee or specification change invalidates a previous acceptance
    new.specs_confirmed := false;
    new.approved_revision_number := null;
  end if;

  if new.status is distinct from old.status then
    if not private.is_valid_transition(old.status, new.status) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if v_role is not null and not private.role_may_transition(v_role, old.status, new.status) then
      raise exception 'FORBIDDEN: a % cannot move an order from % to %', v_role, old.status, new.status using errcode = '42501';
    end if;
    if new.status in ('Confirmed', 'In Production') then
      -- customer accepted the LATEST revision and its quotation
      if not new.specs_confirmed then
        raise exception 'SPECS_NOT_CONFIRMED: customer must confirm specifications first' using errcode = 'P0001';
      end if;
      if new.approved_revision_number is null or new.approved_revision_number is distinct from new.current_revision then
        raise exception 'STALE_REVISION: the confirmed revision is not the latest specification' using errcode = 'P0001';
      end if;
      select * into v_rev from public.order_specification_revisions
      where order_id = new.id and revision_number = new.approved_revision_number;
      -- staff/owner review completed: the approved revision is a shop quotation
      if v_rev.revision_id is null or v_rev.revision_type not in ('staff_draft', 'revised_quote') then
        raise exception 'PENDING_REVIEW: the approved revision has not been quoted by the shop' using errcode = 'P0001';
      end if;
      if new.furniture_price is null or new.paper_slip_number is null then
        raise exception 'PENDING_REVIEW: staff/owner review (price and paper slip) is not complete' using errcode = 'P0001';
      end if;
      -- no price / specification drift since acceptance
      if new.furniture_category is distinct from v_rev.furniture_category
         or new.design_variant is distinct from v_rev.design_variant
         or new.width_cm  is distinct from v_rev.width_cm
         or new.height_cm is distinct from v_rev.height_cm
         or new.depth_cm  is distinct from v_rev.depth_cm
         or new.wood_type is distinct from v_rev.wood_type
         or new.custom_wood_note is distinct from v_rev.custom_wood_note
         or new.color_finish is distinct from v_rev.color_finish
         or new.quantity is distinct from v_rev.quantity
         or new.furniture_price is distinct from v_rev.quoted_furniture_price
         or new.delivery_fee is distinct from v_rev.quoted_delivery_fee then
        raise exception 'SPEC_SNAPSHOT_MISMATCH: order specification differs from the approved revision' using errcode = 'P0001';
      end if;
    end if;
    if new.status = 'Confirmed' or (new.status = 'In Production' and old.status = 'Confirmed') then
      if exists (select 1 from public.order_exceptions_and_repairs e
                 where e.order_id = new.id and e.status = 'Pending' and e.is_production_blocking) then
        raise exception 'PENDING_REVIEW: resolve the open production-blocking items for this order first' using errcode = 'P0001';
      end if;
    end if;
    -- the wood-cutting gate: verified 30% down payment or an approved owner exception
    if new.status = 'In Production' and old.status = 'Confirmed'
       and v_furniture_paid < new.standard_down_payment_due
       and not new.payment_exception_approved then
      raise exception 'DOWN_PAYMENT_REQUIRED: a verified 30%% down payment (%) is required before production; verified so far: %',
        new.standard_down_payment_due, v_furniture_paid using errcode = 'P0001';
    end if;
    if new.status = 'Out for Delivery'
       and v_furniture_paid < new.standard_down_payment_due
       and not new.payment_exception_approved then
      raise exception 'DOWN_PAYMENT_REQUIRED: 30%% down payment or an owner-approved exception is required before dispatch'
        using errcode = 'P0001';
    end if;
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

-- ---------------------------------------------------- add_spec_revision() ----
drop function if exists public.add_spec_revision(uuid, public.revision_type, jsonb, int, text, uuid, jsonb);
create or replace function public.add_spec_revision(
  p_order_id uuid, p_type public.revision_type, p_spec jsonb,
  p_expected_revision int, p_created_by_role text, p_created_by_id uuid default null,
  p_preview_config jsonb default '{}'::jsonb,
  p_quote_validity_days int default 7,
  p_paper_slip_number text default null,
  p_estimated_completion_date date default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_role    public.app_role := (select private.app_role());
  v_prev    public.order_specification_revisions%rowtype;
  v_new     jsonb;
  v_prevj   jsonb;
  v_diff    jsonb;
  v_num     int;
  v_id      uuid;
  v_initial boolean;
  v_shop    boolean := p_type in ('staff_draft', 'revised_quote');
  v_cat     public.furniture_category;
  v_wood    public.wood_type;
  v_w numeric; v_h numeric; v_d numeric; v_price numeric; v_fee numeric; v_qty int;
  v_quoted_at timestamptz; v_expires_at timestamptz;
  v_slip text; v_est date;
begin
  if p_type = 'final_approved' then
    raise exception 'INVALID_REVISION: final_approved revisions are created by acceptance only' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null then
    -- signed-in staff/owner may issue shop revisions; customer revisions come only from the app server after PIN checks
    if not v_shop or coalesce(v_role in ('owner', 'staff'), false) is false then
      raise exception 'FORBIDDEN: not allowed to create % revisions', p_type using errcode = '42501';
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;
  v_initial := not exists (select 1 from public.order_specification_revisions r where r.order_id = p_order_id);

  -- optimistic concurrency on the revision the editor was looking at
  if v_initial then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'STALE_REVISION: this order has no revisions yet' using errcode = 'P0001';
    end if;
    if p_type not in ('staff_draft', 'customer_request') then
      raise exception 'INVALID_REVISION: the first revision must be a staff draft or a customer request' using errcode = 'P0001';
    end if;
  else
    if p_expected_revision is distinct from v_order.current_revision then
      raise exception 'STALE_REVISION: the specification changed (now revision %); reload before editing', v_order.current_revision
        using errcode = 'P0001';
    end if;
    if p_type in ('staff_draft', 'customer_request') then
      raise exception 'INVALID_REVISION: % is only valid as revision 1', p_type using errcode = 'P0001';
    end if;
  end if;

  if (p_type = 'customer_request' and v_order.status <> 'Quote Requested')
     or (p_type = 'customer_proposal' and v_order.status <> 'Waiting for Confirmation')
     or (v_shop and v_order.status not in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed')) then
    raise exception 'SPEC_LOCKED: specifications are locked for workshop production' using errcode = 'P0001';
  end if;

  -- validate and normalise the proposed specification
  v_cat   := (p_spec ->> 'furniture_category')::public.furniture_category;
  v_wood  := (p_spec ->> 'wood_type')::public.wood_type;
  v_w     := (p_spec ->> 'width_cm')::numeric;
  v_h     := (p_spec ->> 'height_cm')::numeric;
  v_d     := (p_spec ->> 'depth_cm')::numeric;
  v_qty   := coalesce((p_spec ->> 'quantity')::int, v_order.quantity);
  if v_shop then
    v_price := (p_spec ->> 'quoted_furniture_price')::numeric;
    v_fee   := coalesce((p_spec ->> 'quoted_delivery_fee')::numeric, v_order.delivery_fee, 0);
    if v_order.municipality = 'Valencia City' then v_fee := 0; end if;
    if v_price is null or v_price <= 0 or v_fee < 0 then
      raise exception 'VALIDATION: a quotation needs a furniture price above 0 and a delivery fee of 0 or more' using errcode = 'P0001';
    end if;
    v_quoted_at  := now();
    v_expires_at := now() + make_interval(days => least(greatest(coalesce(p_quote_validity_days, 7), 1), 90));
    v_slip := coalesce(nullif(trim(p_paper_slip_number), ''), v_order.paper_slip_number);
    v_est  := coalesce(p_estimated_completion_date, v_order.estimated_completion_date);
    if v_slip is null then
      raise exception 'VALIDATION: enter the paper slip number for this quotation' using errcode = 'P0001';
    end if;
    if v_est is null then
      raise exception 'VALIDATION: enter the estimated completion date for this quotation' using errcode = 'P0001';
    end if;
  else
    -- customers never set prices; the current quote (if any) is carried for reference
    v_price := v_order.furniture_price; v_fee := v_order.delivery_fee;
  end if;
  if v_cat is null or nullif(trim(p_spec ->> 'design_variant'), '') is null
     or v_w is null or v_h is null or v_d is null or v_wood is null
     or nullif(trim(p_spec ->> 'color_finish'), '') is null then
    raise exception 'VALIDATION: category, design, width, height, depth, wood and finish are required' using errcode = 'P0001';
  end if;
  if v_w <= 0 or v_w > 1000 or v_h <= 0 or v_h > 1000 or v_d <= 0 or v_d > 1000 then
    raise exception 'VALIDATION: dimensions must be between 0 and 1000 cm' using errcode = 'P0001';
  end if;
  if v_wood = 'Other' and nullif(trim(p_spec ->> 'custom_wood_note'), '') is null then
    raise exception 'VALIDATION: describe the wood when "Other" is selected' using errcode = 'P0001';
  end if;

  v_new := private.spec_json(v_cat, trim(p_spec ->> 'design_variant'), v_w, v_h, v_d, v_wood,
                             p_spec ->> 'custom_wood_note', trim(p_spec ->> 'color_finish'), v_qty, v_price, v_fee);

  if not v_initial then
    select * into v_prev from public.order_specification_revisions
    where order_id = p_order_id and revision_number = v_order.current_revision;
  end if;
  v_prevj := case when v_prev.revision_id is null then '{}'::jsonb else
    private.spec_json(v_prev.furniture_category, v_prev.design_variant, v_prev.width_cm, v_prev.height_cm, v_prev.depth_cm,
                      v_prev.wood_type, v_prev.custom_wood_note, v_prev.color_finish, v_prev.quantity,
                      v_prev.quoted_furniture_price, v_prev.quoted_delivery_fee) end;
  v_diff := private.spec_diff(v_prevj, v_new);
  if v_prev.revision_id is not null and v_diff = '{}'::jsonb and p_type = 'customer_proposal' then
    raise exception 'VALIDATION: no changes to submit' using errcode = 'P0001';
  end if;

  v_num := case when v_initial then 1 else v_order.current_revision + 1 end;
  insert into public.order_specification_revisions (
    order_id, revision_number, revision_type, furniture_category, design_variant, width_cm, height_cm, depth_cm,
    wood_type, custom_wood_note, color_finish, quantity, quoted_furniture_price, quoted_delivery_fee,
    quoted_at, expires_at, spec_preview_config, changed_fields, created_by_role, created_by_id)
  values (p_order_id, v_num, p_type, v_cat, v_new ->> 'design_variant', v_w, v_h, v_d,
    v_wood, v_new ->> 'custom_wood_note', v_new ->> 'color_finish', v_qty, v_price, v_fee,
    v_quoted_at, v_expires_at, coalesce(p_preview_config, '{}'::jsonb), v_diff, p_created_by_role, p_created_by_id)
  returning revision_id into v_id;

  if not v_shop then
    -- customer request / proposal: recorded for review; authoritative spec and price unchanged
    update public.orders set current_revision = v_num, specs_confirmed = false, approved_revision_number = null
    where id = p_order_id;
  else
    update public.orders set
      current_revision = v_num, furniture_category = v_cat, design_variant = v_new ->> 'design_variant',
      width_cm = v_w, height_cm = v_h, depth_cm = v_d, wood_type = v_wood,
      custom_wood_note = v_new ->> 'custom_wood_note', color_finish = v_new ->> 'color_finish',
      quantity = v_qty, furniture_price = v_price, delivery_fee = v_fee,
      paper_slip_number = v_slip, estimated_completion_date = v_est,
      dimensions = trim(to_char(v_w, 'FM9990.0')) || ' × ' || trim(to_char(v_h, 'FM9990.0')) || ' × ' || trim(to_char(v_d, 'FM9990.0')) || ' cm (W × H × D)',
      spec_preview_config = coalesce(p_preview_config, '{}'::jsonb),
      is_legacy_incomplete = false, specs_confirmed = false, approved_revision_number = null,
      status = 'Waiting for Confirmation'
    where id = p_order_id;
  end if;

  return jsonb_build_object('revision_id', v_id, 'revision_number', v_num, 'revision_type', p_type,
    'changed_fields', v_diff, 'quoted_at', v_quoted_at, 'expires_at', v_expires_at);
end;
$$;

-- ------------------------------------------------ accept_order_revision() ----
-- One atomic acceptance of the exact specification AND quotation of the latest
-- issued revision. Row-locked, stale-checked, expiry-checked, amount-checked
-- and idempotent on client_idempotency_key.
drop function if exists public.confirm_spec_revision(uuid, int, public.confirmation_method, text, uuid, text);
create or replace function public.accept_order_revision(
  p_order_id uuid, p_revision_id uuid, p_expected_revision_number int,
  p_accepted_furniture_price numeric, p_accepted_delivery_fee numeric, p_accepted_total_amount numeric,
  p_client_idempotency_key text, p_method public.confirmation_method, p_confirmed_by_name text,
  p_recorded_by uuid default null, p_new_order_code text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_rev   public.order_specification_revisions%rowtype;
  v_prior public.order_confirmations%rowtype;
  v_role  public.app_role := (select private.app_role());
  v_conf  uuid;
  v_now   timestamptz := now();
  v_key   text := nullif(trim(p_client_idempotency_key), '');
begin
  if (select auth.uid()) is not null then
    if coalesce(v_role in ('owner', 'staff'), false) is false or p_method = 'Customer Portal PIN' then
      raise exception 'FORBIDDEN: not allowed to record this acceptance' using errcode = '42501';
    end if;
  end if;
  if v_key is null or length(v_key) > 100 then
    raise exception 'VALIDATION: a client idempotency key is required' using errcode = 'P0001';
  end if;

  -- 1. lock the parent order
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;

  -- 5. idempotent replay: same key + same revision returns the original event
  select * into v_prior from public.order_confirmations
  where order_id = p_order_id and client_idempotency_key = v_key;
  if found then
    if v_prior.revision_id <> p_revision_id then
      raise exception 'IDEMPOTENCY_CONFLICT: this key was already used for a different revision' using errcode = 'P0001';
    end if;
    return jsonb_build_object('confirmation_id', v_prior.id, 'revision_id', v_prior.revision_id,
      'revision_number', v_prior.revision_number, 'duplicate', true);
  end if;

  -- 2. optimistic check against the latest revision
  if p_expected_revision_number is distinct from v_order.current_revision then
    raise exception 'STALE_REVISION: revision % is outdated; the latest is revision %', p_expected_revision_number, v_order.current_revision
      using errcode = 'P0001';
  end if;

  -- 3. the target is the latest customer-eligible issued revision, quote still valid
  select * into v_rev from public.order_specification_revisions
  where revision_id = p_revision_id and order_id = p_order_id;
  if not found or v_rev.revision_number <> v_order.current_revision then
    raise exception 'STALE_REVISION: this is not the latest revision of the order' using errcode = 'P0001';
  end if;
  if v_rev.revision_type not in ('staff_draft', 'revised_quote') then
    raise exception 'PENDING_REVIEW: the shop must review this request and issue a quotation first' using errcode = 'P0001';
  end if;
  if v_order.status <> 'Waiting for Confirmation' then
    raise exception 'INVALID_TRANSITION: order is not waiting for confirmation' using errcode = 'P0001';
  end if;
  if v_order.is_legacy_incomplete then
    raise exception 'VALIDATION: complete the structured specification (category, design, W x H x D) with a revised quote before confirming'
      using errcode = 'P0001';
  end if;
  if v_now > v_rev.expires_at then
    raise exception 'QUOTE_EXPIRED: this quotation expired on %; ask the shop for a fresh quotation', v_rev.expires_at
      using errcode = 'P0001';
  end if;

  -- 4. the customer accepts exactly the quoted amounts
  if round(p_accepted_furniture_price, 2) is distinct from v_rev.quoted_furniture_price
     or round(p_accepted_delivery_fee, 2) is distinct from v_rev.quoted_delivery_fee
     or round(p_accepted_total_amount, 2) is distinct from round(v_rev.quoted_furniture_price + v_rev.quoted_delivery_fee, 2) then
    raise exception 'AMOUNT_MISMATCH: the accepted amounts do not match the quotation' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_exceptions_and_repairs e
             where e.order_id = p_order_id and e.status = 'Pending' and e.is_production_blocking) then
    raise exception 'PENDING_REVIEW: resolve the open specification review items for this order first' using errcode = 'P0001';
  end if;

  -- 6. immutable acceptance event (specification + quotation, same revision)
  insert into public.order_confirmations (order_id, version_number, revision_number, revision_id, confirmed_specs_snapshot,
    confirmation_method, confirmed_by_name, recorded_by_staff_id, confirmed_at,
    specification_accepted_at, quotation_accepted_at, accepted_furniture_price, accepted_delivery_fee,
    accepted_total_amount, client_idempotency_key)
  values (p_order_id, v_rev.revision_number, v_rev.revision_number, v_rev.revision_id,
    private.spec_json(v_rev.furniture_category, v_rev.design_variant, v_rev.width_cm, v_rev.height_cm, v_rev.depth_cm,
      v_rev.wood_type, v_rev.custom_wood_note, v_rev.color_finish, v_rev.quantity,
      v_rev.quoted_furniture_price, v_rev.quoted_delivery_fee)
      || jsonb_build_object('item_name', v_order.item_name, 'dimensions', v_order.dimensions,
                            'furniture_price', v_rev.quoted_furniture_price, 'expires_at', v_rev.expires_at),
    p_method, coalesce(nullif(trim(p_confirmed_by_name), ''), v_order.customer_name), p_recorded_by, v_now,
    v_now, v_now, v_rev.quoted_furniture_price, v_rev.quoted_delivery_fee,
    round(v_rev.quoted_furniture_price + v_rev.quoted_delivery_fee, 2), v_key)
  returning id into v_conf;

  -- 7. confirmed (not yet authorized to cut wood: the 30% gate guards In Production)
  update public.orders set
    approved_revision_number = v_rev.revision_number, specs_confirmed = true, status = 'Confirmed',
    order_code = coalesce(p_new_order_code, order_code)
  where id = p_order_id;

  return jsonb_build_object('confirmation_id', v_conf, 'revision_id', v_rev.revision_id,
    'revision_number', v_rev.revision_number, 'duplicate', false);
end;
$$;

-- -------------------------------------------------------- customer_track ----
-- Order ID only: stage + dates. Unchanged columns; null-safe for quote requests.

-- ------------------------------------------------------------- privileges ----
revoke all on function public.add_spec_revision(uuid, public.revision_type, jsonb, int, text, uuid, jsonb, int, text, date) from public, anon;
grant execute on function public.add_spec_revision(uuid, public.revision_type, jsonb, int, text, uuid, jsonb, int, text, date) to authenticated, service_role;
revoke all on function public.accept_order_revision(uuid, uuid, int, numeric, numeric, numeric, text, public.confirmation_method, text, uuid, text) from public, anon;
grant execute on function public.accept_order_revision(uuid, uuid, int, numeric, numeric, numeric, text, public.confirmation_method, text, uuid, text) to authenticated, service_role;
revoke all on function private.role_may_transition(public.app_role, public.order_status, public.order_status) from public;
grant execute on function private.role_may_transition(public.app_role, public.order_status, public.order_status) to authenticated, service_role;
revoke all on function private.append_only_guard() from public;
revoke all on function private.payments_guard() from public;
revoke all on function private.exceptions_before_insert() from public;
