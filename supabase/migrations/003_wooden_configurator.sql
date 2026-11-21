-- =============================================================================
-- Migration 003: furniture configurator, immutable specification revisions,
-- revision-linked customer confirmations and the 6-condition production gate.
--
-- (The add-on brief calls this file 002_wooden_configurator.sql; 002 is already
--  used by 002_security_hardening on the live project, so it is 003.)
--
-- ADDITIVE ONLY: new nullable columns, a new table, new/replaced functions.
-- No existing column is dropped, renamed or rewritten. Legacy free-text
-- dimensions stay in orders.dimensions untouched; the new width/height/depth
-- columns are left NULL for existing rows (their axis order is not recorded,
-- so mapping them would be a guess) and those rows are flagged
-- is_legacy_incomplete = true.
-- =============================================================================

-- ----------------------------------------------------------------- types ----
do $$ begin
  create type public.furniture_category as enum
    ('Panel Door', 'Dining Table', 'Living Room Set', 'Kitchen / Wall Cabinet', 'Custom Piece');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.revision_type as enum
    ('staff_draft', 'customer_proposal', 'revised_quote', 'final_approved');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------- orders: new columns ----
-- wood_type and color_finish already exist (001) and are preserved as-is.
alter table public.orders
  add column if not exists furniture_category        public.furniture_category,
  add column if not exists design_variant            text,
  add column if not exists width_cm                  numeric(6,1),
  add column if not exists height_cm                 numeric(6,1),
  add column if not exists depth_cm                  numeric(6,1),
  add column if not exists custom_wood_note          text,
  add column if not exists current_revision          int,
  add column if not exists approved_revision_number  int,
  add column if not exists spec_preview_config       jsonb not null default '{}'::jsonb,
  add column if not exists is_legacy_incomplete      boolean not null default false;

comment on column public.orders.spec_preview_config is
  'Presentation-only settings for the illustrative preview (camera angle, callout flags). Never a source of specification data.';
comment on column public.orders.dimensions is
  'Human-readable dimensions. For configurator orders it is generated from width/height/depth; for legacy rows it is the original free text.';

-- -------------------------------------------------------------- backfill ----
-- Existing rows: no category/variant/W×H×D can be derived safely -> legacy.
update public.orders
set is_legacy_incomplete = true
where furniture_category is null
   or width_cm is null or height_cm is null or depth_cm is null;

-- ------------------------------------------------------------ constraints ----
do $$ begin
  alter table public.orders add constraint orders_width_range  check (width_cm  is null or (width_cm  > 0 and width_cm  <= 1000));
  alter table public.orders add constraint orders_height_range check (height_cm is null or (height_cm > 0 and height_cm <= 1000));
  alter table public.orders add constraint orders_depth_range  check (depth_cm  is null or (depth_cm  > 0 and depth_cm  <= 1000));
  -- New (non-legacy) orders must carry the full structured specification.
  alter table public.orders add constraint orders_structured_spec_required check (
    is_legacy_incomplete
    or (furniture_category is not null and nullif(trim(design_variant), '') is not null
        and width_cm is not null and height_cm is not null and depth_cm is not null)
  );
  alter table public.orders add constraint orders_approved_le_current check (
    approved_revision_number is null or (current_revision is not null and approved_revision_number <= current_revision)
  );
exception when duplicate_object then null; end $$;

-- "Other" wood needs a note. Added NOT VALID so pre-existing rows cannot block
-- the migration, then validated when the existing data already complies.
do $$ begin
  alter table public.orders add constraint orders_other_wood_note
    check (wood_type <> 'Other' or nullif(trim(custom_wood_note), '') is not null) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.orders validate constraint orders_other_wood_note;
exception when check_violation then
  raise notice 'orders_other_wood_note left NOT VALID: existing "Other" wood rows lack a note (enforced for new/updated rows)';
end $$;

-- ------------------------------------- order_specification_revisions ----
create table if not exists public.order_specification_revisions (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders (id) on delete cascade,
  revision_number         int not null check (revision_number > 0),
  revision_type           public.revision_type not null,
  furniture_category      public.furniture_category,
  design_variant          text,
  width_cm                numeric(6,1) check (width_cm  is null or (width_cm  > 0 and width_cm  <= 1000)),
  height_cm               numeric(6,1) check (height_cm is null or (height_cm > 0 and height_cm <= 1000)),
  depth_cm                numeric(6,1) check (depth_cm  is null or (depth_cm  > 0 and depth_cm  <= 1000)),
  wood_type               public.wood_type not null,
  custom_wood_note        text,
  color_finish            text not null,
  quantity                int not null check (quantity > 0),
  legacy_dimensions_text  text,
  quoted_furniture_price  numeric(10,2) not null check (quoted_furniture_price > 0),
  quoted_delivery_fee     numeric(10,2) not null check (quoted_delivery_fee >= 0),
  spec_preview_config     jsonb not null default '{}'::jsonb,
  changed_fields          jsonb not null default '{}'::jsonb,
  created_by_role         text not null,
  created_by_id           uuid references public.profiles (id),
  created_at              timestamptz not null default now(),
  unique (order_id, revision_number),
  check (wood_type <> 'Other' or nullif(trim(custom_wood_note), '') is not null)
);
create index if not exists spec_revisions_order_idx on public.order_specification_revisions (order_id, revision_number desc);
create index if not exists spec_revisions_created_by_idx on public.order_specification_revisions (created_by_id);

-- Revisions are immutable history.
create or replace function private.spec_revisions_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_REVISION: specification revisions cannot be changed or deleted' using errcode = '42501';
end; $$;
drop trigger if exists spec_revisions_immutable on public.order_specification_revisions;
create trigger spec_revisions_immutable
  before update on public.order_specification_revisions
  for each row execute function private.spec_revisions_immutable();

-- --------------------------------------------- order_confirmations link ----
alter table public.order_confirmations
  add column if not exists revision_id      uuid references public.order_specification_revisions (id),
  add column if not exists revision_number  int;
create index if not exists order_confirmations_revision_idx on public.order_confirmations (revision_id);

-- Backfill revision 1 for every existing order from its current values, and
-- link existing confirmations (version 1) to it.
insert into public.order_specification_revisions (
  order_id, revision_number, revision_type, furniture_category, design_variant, width_cm, height_cm, depth_cm,
  wood_type, custom_wood_note, color_finish, quantity, legacy_dimensions_text, quoted_furniture_price,
  quoted_delivery_fee, changed_fields, created_by_role, created_by_id, created_at)
select o.id, 1, 'staff_draft', o.furniture_category, o.design_variant, o.width_cm, o.height_cm, o.depth_cm,
       o.wood_type, o.custom_wood_note, o.color_finish, o.quantity, o.dimensions, o.furniture_price,
       o.delivery_fee, '{"backfill": "created from existing order by migration 003"}'::jsonb,
       'system (migration 003 backfill)', o.encoded_by_id, o.created_at
from public.orders o
where not exists (select 1 from public.order_specification_revisions r where r.order_id = o.id);

update public.orders o set current_revision = 1 where current_revision is null;
update public.orders o set approved_revision_number = 1
where specs_confirmed and approved_revision_number is null;

update public.order_confirmations c
set revision_id = r.id, revision_number = r.revision_number
from public.order_specification_revisions r
where c.revision_id is null and r.order_id = c.order_id and r.revision_number = c.version_number;

-- ------------------------------------------------------ helper functions ----
create or replace function private.spec_json(
  p_category public.furniture_category, p_variant text, p_w numeric, p_h numeric, p_d numeric,
  p_wood public.wood_type, p_note text, p_finish text, p_qty int, p_price numeric, p_fee numeric)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'furniture_category', p_category, 'design_variant', p_variant,
    'width_cm', p_w, 'height_cm', p_h, 'depth_cm', p_d,
    'wood_type', p_wood, 'custom_wood_note', nullif(trim(coalesce(p_note, '')), ''),
    'color_finish', p_finish, 'quantity', p_qty,
    'quoted_furniture_price', p_price, 'quoted_delivery_fee', p_fee)
$$;

-- Field-level diff {field: {"from": a, "to": b}} between two spec objects.
create or replace function private.spec_diff(p_from jsonb, p_to jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', p_from -> k, 'to', p_to -> k)), '{}'::jsonb)
  from jsonb_object_keys(p_to) k
  where (p_from -> k) is distinct from (p_to -> k)
$$;

-- -------------------------------------------------- add_spec_revision() ----
-- The only way to change an order's specification. Locks the order row
-- (SELECT ... FOR UPDATE) so concurrent staff and customer edits serialize and
-- can never produce duplicate or overwritten revision numbers.
--   staff_draft / revised_quote : office (owner/staff JWT) or server; becomes the
--                                 order's authoritative spec + quote.
--   customer_proposal           : server only (customer portal after PIN check);
--                                 recorded for review, does NOT change the
--                                 authoritative spec and does NOT unlock anything.
-- p_expected_revision: optimistic check — the revision the editor was looking at.
create or replace function public.add_spec_revision(
  p_order_id uuid, p_type public.revision_type, p_spec jsonb,
  p_expected_revision int, p_created_by_role text, p_created_by_id uuid default null,
  p_preview_config jsonb default '{}'::jsonb)
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
  v_cat     public.furniture_category;
  v_wood    public.wood_type;
  v_w numeric; v_h numeric; v_d numeric; v_price numeric; v_fee numeric; v_qty int;
begin
  -- who may create which revision type
  if p_type = 'final_approved' then
    raise exception 'INVALID_REVISION: final_approved revisions are created by confirmation only' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null then
    if p_type = 'customer_proposal' or coalesce(v_role in ('owner', 'staff'), false) is false then
      raise exception 'FORBIDDEN: not allowed to create % revisions', p_type using errcode = '42501';
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;

  if p_expected_revision is distinct from v_order.current_revision then
    raise exception 'STALE_REVISION: the specification changed (now revision %); reload before editing', v_order.current_revision
      using errcode = 'P0001';
  end if;
  if v_order.status not in ('Waiting for Confirmation', 'Confirmed')
     or (p_type = 'customer_proposal' and v_order.status <> 'Waiting for Confirmation') then
    raise exception 'SPEC_LOCKED: specifications are locked for workshop production' using errcode = 'P0001';
  end if;

  -- validate and normalise the proposed specification
  v_cat   := (p_spec ->> 'furniture_category')::public.furniture_category;
  v_wood  := (p_spec ->> 'wood_type')::public.wood_type;
  v_w     := (p_spec ->> 'width_cm')::numeric;
  v_h     := (p_spec ->> 'height_cm')::numeric;
  v_d     := (p_spec ->> 'depth_cm')::numeric;
  v_qty   := coalesce((p_spec ->> 'quantity')::int, v_order.quantity);
  v_price := coalesce((p_spec ->> 'quoted_furniture_price')::numeric, v_order.furniture_price);
  v_fee   := coalesce((p_spec ->> 'quoted_delivery_fee')::numeric, v_order.delivery_fee);
  if v_order.municipality = 'Valencia City' then v_fee := 0; end if;
  if p_type = 'customer_proposal' then
    -- customers cannot set prices; the quote stays until the shop revises it
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

  select * into v_prev from public.order_specification_revisions
  where order_id = p_order_id and revision_number = v_order.current_revision;
  v_prevj := case when v_prev.id is null then '{}'::jsonb else
    private.spec_json(v_prev.furniture_category, v_prev.design_variant, v_prev.width_cm, v_prev.height_cm, v_prev.depth_cm,
                      v_prev.wood_type, v_prev.custom_wood_note, v_prev.color_finish, v_prev.quantity,
                      v_prev.quoted_furniture_price, v_prev.quoted_delivery_fee) end;
  v_diff := private.spec_diff(v_prevj, v_new);
  if v_prev.id is not null and v_diff = '{}'::jsonb and p_type = 'customer_proposal' then
    raise exception 'VALIDATION: no changes to submit' using errcode = 'P0001';
  end if;

  v_num := coalesce(v_order.current_revision, 0) + 1;
  insert into public.order_specification_revisions (
    order_id, revision_number, revision_type, furniture_category, design_variant, width_cm, height_cm, depth_cm,
    wood_type, custom_wood_note, color_finish, quantity, quoted_furniture_price, quoted_delivery_fee,
    spec_preview_config, changed_fields, created_by_role, created_by_id)
  values (p_order_id, v_num, p_type, v_cat, v_new ->> 'design_variant', v_w, v_h, v_d,
    v_wood, v_new ->> 'custom_wood_note', v_new ->> 'color_finish', v_qty, v_price, v_fee,
    coalesce(p_preview_config, '{}'::jsonb), v_diff, p_created_by_role, p_created_by_id)
  returning id into v_id;

  if p_type = 'customer_proposal' then
    update public.orders set current_revision = v_num, specs_confirmed = false, approved_revision_number = null
    where id = p_order_id;
  else
    update public.orders set
      current_revision = v_num, furniture_category = v_cat, design_variant = v_new ->> 'design_variant',
      width_cm = v_w, height_cm = v_h, depth_cm = v_d, wood_type = v_wood,
      custom_wood_note = v_new ->> 'custom_wood_note', color_finish = v_new ->> 'color_finish',
      quantity = v_qty, furniture_price = v_price, delivery_fee = v_fee,
      dimensions = trim(to_char(v_w, 'FM9990.0')) || ' × ' || trim(to_char(v_h, 'FM9990.0')) || ' × ' || trim(to_char(v_d, 'FM9990.0')) || ' cm (W × H × D)',
      spec_preview_config = coalesce(p_preview_config, '{}'::jsonb),
      is_legacy_incomplete = false, specs_confirmed = false, approved_revision_number = null,
      status = 'Waiting for Confirmation'
    where id = p_order_id;
  end if;

  return jsonb_build_object('id', v_id, 'revision_number', v_num, 'revision_type', p_type, 'changed_fields', v_diff);
end;
$$;

-- ----------------------------------------------- confirm_spec_revision() ----
-- Records the customer's explicit confirmation of ONE exact revision and moves
-- the order to Confirmed in the same transaction. Rejects stale revisions,
-- customer proposals (the shop must quote first) and orders with open reviews.
create or replace function public.confirm_spec_revision(
  p_order_id uuid, p_revision_number int, p_method public.confirmation_method,
  p_confirmed_by_name text, p_recorded_by uuid default null, p_new_order_code text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_rev   public.order_specification_revisions%rowtype;
  v_role  public.app_role := (select private.app_role());
  v_conf  uuid;
begin
  if (select auth.uid()) is not null then
    if coalesce(v_role in ('owner', 'staff'), false) is false or p_method = 'Customer Portal PIN' then
      raise exception 'FORBIDDEN: not allowed to record this confirmation' using errcode = '42501';
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;
  if v_order.status <> 'Waiting for Confirmation' then
    raise exception 'INVALID_TRANSITION: order is not waiting for confirmation' using errcode = 'P0001';
  end if;
  if v_order.is_legacy_incomplete then
    raise exception 'VALIDATION: complete the structured specification (category, design, W x H x D) with a revised quote before confirming'
      using errcode = 'P0001';
  end if;
  if p_revision_number is distinct from v_order.current_revision then
    raise exception 'STALE_REVISION: revision % is outdated; the latest is revision %', p_revision_number, v_order.current_revision
      using errcode = 'P0001';
  end if;
  select * into v_rev from public.order_specification_revisions
  where order_id = p_order_id and revision_number = p_revision_number;
  if v_rev.revision_type = 'customer_proposal' then
    raise exception 'PENDING_REVIEW: the shop must review the proposed changes and send a revised quote first'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_exceptions_and_repairs e where e.order_id = p_order_id and e.status = 'Pending') then
    raise exception 'PENDING_REVIEW: resolve the open review items for this order first' using errcode = 'P0001';
  end if;

  insert into public.order_confirmations (order_id, version_number, revision_number, revision_id, confirmed_specs_snapshot,
    confirmation_method, confirmed_by_name, recorded_by_staff_id)
  values (p_order_id, p_revision_number, p_revision_number, v_rev.id,
    private.spec_json(v_rev.furniture_category, v_rev.design_variant, v_rev.width_cm, v_rev.height_cm, v_rev.depth_cm,
      v_rev.wood_type, v_rev.custom_wood_note, v_rev.color_finish, v_rev.quantity,
      v_rev.quoted_furniture_price, v_rev.quoted_delivery_fee)
      || jsonb_build_object('item_name', v_order.item_name, 'dimensions', v_order.dimensions, 'furniture_price', v_rev.quoted_furniture_price),
    p_method, coalesce(nullif(trim(p_confirmed_by_name), ''), v_order.customer_name), p_recorded_by)
  returning id into v_conf;

  update public.orders set
    approved_revision_number = p_revision_number, specs_confirmed = true, status = 'Confirmed',
    order_code = coalesce(p_new_order_code, order_code)
  where id = p_order_id;

  return jsonb_build_object('confirmation_id', v_conf, 'revision_id', v_rev.id, 'revision_number', p_revision_number);
end;
$$;

-- -------------------------------- orders trigger: the 6-condition gate ----
create or replace function private.orders_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_furniture_paid numeric(10,2);
  v_fee_paid       numeric(10,2);
  v_overflow       numeric(10,2);
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
    if new.status not in ('Waiting for Confirmation') then
      raise exception 'SPEC_LOCKED: specifications and quote are locked once confirmed; use a change request'
        using errcode = 'P0001';
    end if;
    -- any change voids a previous approval
    new.specs_confirmed := false;
    new.approved_revision_number := null;
  end if;

  if new.status is distinct from old.status then
    if not private.is_valid_transition(old.status, new.status) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if new.status in ('Confirmed', 'In Production') then
      -- (1)+(2) explicit customer confirmation of the LATEST revision (its quote included)
      if not new.specs_confirmed then
        raise exception 'SPECS_NOT_CONFIRMED: customer must confirm specifications first' using errcode = 'P0001';
      end if;
      if new.approved_revision_number is null or new.approved_revision_number is distinct from new.current_revision then
        raise exception 'STALE_REVISION: the confirmed revision is not the latest specification' using errcode = 'P0001';
      end if;
      select * into v_rev from public.order_specification_revisions
      where order_id = new.id and revision_number = new.approved_revision_number;
      -- (3) staff/owner review completed: the approved revision is a shop quote, not a proposal
      if v_rev.id is null or v_rev.revision_type = 'customer_proposal' then
        raise exception 'PENDING_REVIEW: the approved revision has not been quoted by the shop' using errcode = 'P0001';
      end if;
      -- (4) no unresolved review items
      if exists (select 1 from public.order_exceptions_and_repairs e where e.order_id = new.id and e.status = 'Pending') then
        raise exception 'PENDING_REVIEW: resolve the open review items for this order first' using errcode = 'P0001';
      end if;
      -- (6) the order's authoritative spec + quote equal the approved revision snapshot
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
    -- (5) valid preceding status is enforced by is_valid_transition above
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

-- ------------------------------------------- workshop view: new columns ----
drop function if exists public.workshop_orders();
create function public.workshop_orders()
returns table (
  id uuid, order_code text, item_name text, quantity int, dimensions text,
  wood_type public.wood_type, color_finish text, special_instructions text,
  reference_photo_url text, status public.order_status, priority_rank int,
  priority_label public.priority_label, assigned_craftsman_id uuid,
  estimated_completion_date date, version int, updated_at timestamptz, needs_revision boolean,
  furniture_category public.furniture_category, design_variant text,
  width_cm numeric, height_cm numeric, depth_cm numeric, custom_wood_note text,
  approved_revision_number int, is_legacy_incomplete boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and coalesce((select private.app_role()) in ('craftsman', 'owner', 'staff'), false) is false then
    raise exception 'FORBIDDEN: workshop jobs are for shop staff only' using errcode = '42501';
  end if;
  return query
  select
    o.id, o.order_code, o.item_name, o.quantity, o.dimensions, o.wood_type, o.color_finish,
    o.special_instructions, o.reference_photo_url, o.status, o.priority_rank, o.priority_label,
    o.assigned_craftsman_id, o.estimated_completion_date, o.version, o.updated_at,
    exists (
      select 1 from public.order_status_history h
      where h.order_id = o.id
        and h.from_status = 'Completed / For Inspection' and h.to_status = 'In Production'
        and h.changed_at = (select max(h2.changed_at) from public.order_status_history h2 where h2.order_id = o.id)
    ),
    o.furniture_category, o.design_variant, o.width_cm, o.height_cm, o.depth_cm, o.custom_wood_note,
    o.approved_revision_number, o.is_legacy_incomplete
  from public.orders o
  where o.status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery');
end;
$$;
revoke all on function public.workshop_orders() from public, anon;
grant execute on function public.workshop_orders() to authenticated, service_role;

-- --------------------------------------------------------- privileges ----
revoke all on function public.add_spec_revision(uuid, public.revision_type, jsonb, int, text, uuid, jsonb) from public, anon;
grant execute on function public.add_spec_revision(uuid, public.revision_type, jsonb, int, text, uuid, jsonb) to authenticated, service_role;
revoke all on function public.confirm_spec_revision(uuid, int, public.confirmation_method, text, uuid, text) from public, anon;
grant execute on function public.confirm_spec_revision(uuid, int, public.confirmation_method, text, uuid, text) to authenticated, service_role;
revoke all on function private.spec_json(public.furniture_category, text, numeric, numeric, numeric, public.wood_type, text, text, int, numeric, numeric) from public;
revoke all on function private.spec_diff(jsonb, jsonb) from public;
revoke all on function private.spec_revisions_immutable() from public;

-- ------------------------------------------------------------------ RLS ----
alter table public.order_specification_revisions enable row level security;
revoke all on public.order_specification_revisions from anon;
drop policy if exists spec_revisions_office_select on public.order_specification_revisions;
create policy spec_revisions_office_select on public.order_specification_revisions for select to authenticated
  using ((select private.is_office()));
-- Inserts happen only through add_spec_revision() (SECURITY DEFINER); no direct
-- insert/update/delete policy exists for any API role.
