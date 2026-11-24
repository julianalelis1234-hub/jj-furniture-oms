-- 009b · Confirm → Quotation → Accept + plan → Customer payments
--
-- New order flow (JJ Enterprises HCI spec):
--   1. Submission (online or walk-in) gets its final JJ-YYYY-#### code at once and
--      waits as 'Waiting for Confirmation'. Online orders use the code as their slip.
--   2. The shop confirms the order  -> 'Confirmed' (confirmed_at). No price needed yet.
--   3. The shop issues the quotation (a shop revision while Confirmed): status stays
--      'Confirmed', quotation_issued_at is set, any earlier acceptance is void.
--   4. The customer accepts that quotation and chooses a payment plan + channel:
--      accept_order_revision() records the acceptance WITHOUT changing status.
--   5. Customers submit payments (reference no. + proof) as UNVERIFIED rows; staff
--      verify or reject them. Only verified rows count toward any balance.
--   6. 'In Production' now carries every acceptance check (latest shop revision
--      accepted, price + slip, no drift, no blocking items) plus the 30% gate.
--
-- Re-runnable. Never edits migrations 001-008.

-- ----------------------------------------------------------- new columns ----
alter table public.orders
  add column if not exists confirmed_at              timestamptz,
  add column if not exists quotation_issued_at       timestamptz,
  add column if not exists payment_plan              text,
  add column if not exists preferred_payment_method  public.payment_method;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_plan_chk') then
    alter table public.orders add constraint orders_payment_plan_chk
      check (payment_plan is null or payment_plan in ('down_30', 'installment', 'full'));
  end if;
end $$;

-- orders that are already Confirmed or later count as confirmed + quoted
update public.orders set confirmed_at = coalesce(confirmed_at, updated_at)
where confirmed_at is null and status not in ('Quote Requested', 'Waiting for Confirmation');
update public.orders set quotation_issued_at = coalesce(quotation_issued_at, updated_at)
where quotation_issued_at is null and status not in ('Quote Requested', 'Waiting for Confirmation');

alter table public.payments
  add column if not exists reference_number  text check (reference_number is null or length(reference_number) between 3 and 60),
  add column if not exists proof_path        text check (proof_path is null or length(proof_path) <= 300),
  add column if not exists submitted_by      uuid references public.profiles (id),
  add column if not exists rejected_at       timestamptz,
  add column if not exists rejected_by_id    uuid references public.profiles (id),
  add column if not exists rejection_reason  text;
create index if not exists payments_submitted_by_idx on public.payments (submitted_by);
create index if not exists payments_rejected_by_idx on public.payments (rejected_by_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_rejection_chk') then
    alter table public.payments add constraint payments_rejection_chk check (
      (rejected_at is null and rejection_reason is null)
      or (rejected_at is not null and length(trim(coalesce(rejection_reason, ''))) > 0 and not verified_by_owner_or_staff));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_online_reference_chk') then
    -- online and bank payments must carry the transaction reference number
    alter table public.payments add constraint payments_online_reference_chk check (
      payment_method not in ('Online Payment (GCash / Maya)', 'Bank Transfer') or reference_number is not null) not valid;
  end if;
end $$;

-- A submitted order waits for confirmation without a price; the quotation
-- (price, slip, completion date) is required once it is issued or work starts.
alter table public.orders drop constraint if exists orders_quote_fields_required;
alter table public.orders add constraint orders_quote_fields_required check (
  (status in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed') and quotation_issued_at is null)
  or (furniture_price is not null and paper_slip_number is not null and estimated_completion_date is not null)
);

-- Confirmed now precedes the customer's acceptance (accepted later, before production).
alter table public.orders drop constraint if exists orders_specs_gate;
alter table public.orders add constraint orders_specs_gate
  check (status in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed') or specs_confirmed);

-- --------------------------------------------------------- payments guard ----
-- Ledger rows stay immutable. Allowed changes: verify (false -> true) OR reject
-- (once, with a reason) an unverified row, and append to notes.
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
     or new.reference_number is distinct from old.reference_number or new.proof_path is distinct from old.proof_path
     or new.submitted_by is distinct from old.submitted_by
     or (old.verified_by_owner_or_staff and not new.verified_by_owner_or_staff)
     or (old.rejected_at is not null and (new.rejected_at is distinct from old.rejected_at
         or new.rejection_reason is distinct from old.rejection_reason or new.rejected_by_id is distinct from old.rejected_by_id))
     or (old.notes is not null and (new.notes is null or left(new.notes, length(old.notes)) <> old.notes)) then
    raise exception 'IMMUTABLE_RECORD: only verification, rejection and appended notes may change on a payment' using errcode = '42501';
  end if;
  if old.rejected_at is not null and new.verified_by_owner_or_staff then
    raise exception 'IMMUTABLE_RECORD: a rejected payment cannot be verified; ask the customer to submit it again' using errcode = '42501';
  end if;
  if old.verified_by_owner_or_staff and new.rejected_at is not null then
    raise exception 'IMMUTABLE_RECORD: a verified payment cannot be rejected; record a correcting entry instead' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ------------------------------------------------------------ orders gate ----
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

  v_price                         := coalesce(new.furniture_price, 0);
  new.standard_down_payment_due   := round(v_price * 0.30, 2);
  new.remaining_furniture_balance := greatest(0, round(v_price - v_furniture_paid, 2));
  v_overflow                      := greatest(0, v_furniture_paid - v_price);
  new.collectible_on_delivery     := round(new.remaining_furniture_balance
                                     + greatest(0, new.delivery_fee - v_fee_paid - v_overflow), 2);

  if tg_op = 'INSERT' then
    if new.status not in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed') and not new.specs_confirmed then
      raise exception 'SPECS_NOT_CONFIRMED: order % cannot start at % before the customer accepts the quotation',
        new.order_code, new.status using errcode = 'P0001';
    end if;
    if new.status not in ('Quote Requested', 'Waiting for Confirmation') then
      new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
    new.version := 1;
    return new;
  end if;

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
    -- the production lock: specification and price are frozen from In Production on
    if old.status not in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed') then
      raise exception 'SPEC_LOCKED: specifications and quote are locked once production starts; use a change request'
        using errcode = 'P0001';
    end if;
    new.specs_confirmed := false;
    new.approved_revision_number := null;
  end if;

  -- a new quotation (or any spec change) voids the customer's plan choice too
  if not new.specs_confirmed and old.specs_confirmed then
    new.payment_plan := null;
  end if;

  if new.status is distinct from old.status then
    if not private.is_valid_transition(old.status, new.status) then
      raise exception 'INVALID_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
    if v_role is not null and not private.role_may_transition(v_role, old.status, new.status) then
      raise exception 'FORBIDDEN: a % cannot move an order from % to %', v_role, old.status, new.status using errcode = '42501';
    end if;
    if new.status = 'Confirmed' then
      -- shop confirmation of the submitted order: the order is complete and nothing blocks it
      if new.is_legacy_incomplete then
        raise exception 'VALIDATION: complete the structured specification (category, design, W x H x D) before confirming'
          using errcode = 'P0001';
      end if;
      if exists (select 1 from public.order_exceptions_and_repairs e
                 where e.order_id = new.id and e.status = 'Pending' and e.is_production_blocking) then
        raise exception 'PENDING_REVIEW: resolve the open production-blocking items for this order first' using errcode = 'P0001';
      end if;
      new.confirmed_at := coalesce(new.confirmed_at, now());
    end if;
    if new.status = 'In Production' and old.status = 'Confirmed' then
      if new.quotation_issued_at is null then
        raise exception 'PENDING_REVIEW: issue the quotation before production' using errcode = 'P0001';
      end if;
      if not new.specs_confirmed then
        raise exception 'SPECS_NOT_CONFIRMED: the customer must accept the quotation first' using errcode = 'P0001';
      end if;
      if new.approved_revision_number is null or new.approved_revision_number is distinct from new.current_revision then
        raise exception 'STALE_REVISION: the accepted revision is not the latest specification' using errcode = 'P0001';
      end if;
      select * into v_rev from public.order_specification_revisions
      where order_id = new.id and revision_number = new.approved_revision_number;
      if v_rev.revision_id is null or v_rev.revision_type not in ('staff_draft', 'revised_quote') then
        raise exception 'PENDING_REVIEW: the accepted revision has not been quoted by the shop' using errcode = 'P0001';
      end if;
      if new.furniture_price is null or new.paper_slip_number is null then
        raise exception 'PENDING_REVIEW: staff/owner review (price and paper slip) is not complete' using errcode = 'P0001';
      end if;
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
        raise exception 'SPEC_SNAPSHOT_MISMATCH: order specification differs from the accepted revision' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.order_exceptions_and_repairs e
                 where e.order_id = new.id and e.status = 'Pending' and e.is_production_blocking) then
        raise exception 'PENDING_REVIEW: resolve the open production-blocking items for this order first' using errcode = 'P0001';
      end if;
      if v_furniture_paid < new.standard_down_payment_due and not new.payment_exception_approved then
        raise exception 'DOWN_PAYMENT_REQUIRED: a verified 30%% down payment (%) is required before production; verified so far: %',
          new.standard_down_payment_due, v_furniture_paid using errcode = 'P0001';
      end if;
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
-- Same signature as 004b. Status rules for the new flow:
--   customer_request  : revision 1 of an online submission ('Waiting for Confirmation'; legacy 'Quote Requested')
--   customer_proposal : a change request before production ('Waiting for Confirmation' or 'Confirmed')
--   shop revision     : keeps the status; while Confirmed it IS the issued quotation.
--                       A legacy 'Quote Requested' order moves to 'Waiting for Confirmation'.
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
  v_status public.order_status;
begin
  if p_type = 'final_approved' then
    raise exception 'INVALID_REVISION: final_approved revisions are created by acceptance only' using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null then
    if not v_shop or coalesce(v_role in ('owner', 'staff'), false) is false then
      raise exception 'FORBIDDEN: not allowed to create % revisions', p_type using errcode = '42501';
    end if;
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;
  v_initial := not exists (select 1 from public.order_specification_revisions r where r.order_id = p_order_id);

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

  if (p_type = 'customer_request' and v_order.status not in ('Quote Requested', 'Waiting for Confirmation'))
     or (p_type = 'customer_proposal' and v_order.status not in ('Waiting for Confirmation', 'Confirmed'))
     or (v_shop and v_order.status not in ('Quote Requested', 'Waiting for Confirmation', 'Confirmed')) then
    raise exception 'SPEC_LOCKED: specifications are locked for workshop production' using errcode = 'P0001';
  end if;

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
    update public.orders set current_revision = v_num, specs_confirmed = false, approved_revision_number = null
    where id = p_order_id;
  else
    v_status := case when v_order.status = 'Quote Requested' then 'Waiting for Confirmation'::public.order_status else v_order.status end;
    update public.orders set
      current_revision = v_num, furniture_category = v_cat, design_variant = v_new ->> 'design_variant',
      width_cm = v_w, height_cm = v_h, depth_cm = v_d, wood_type = v_wood,
      custom_wood_note = v_new ->> 'custom_wood_note', color_finish = v_new ->> 'color_finish',
      quantity = v_qty, furniture_price = v_price, delivery_fee = v_fee,
      paper_slip_number = v_slip, estimated_completion_date = v_est,
      dimensions = trim(to_char(v_w, 'FM9990.0')) || ' × ' || trim(to_char(v_h, 'FM9990.0')) || ' × ' || trim(to_char(v_d, 'FM9990.0')) || ' cm (W × H × D)',
      spec_preview_config = coalesce(p_preview_config, '{}'::jsonb),
      is_legacy_incomplete = false, specs_confirmed = false, approved_revision_number = null,
      status = v_status,
      quotation_issued_at = case when v_status = 'Confirmed' then now() else quotation_issued_at end
    where id = p_order_id;
  end if;

  return jsonb_build_object('revision_id', v_id, 'revision_number', v_num, 'revision_type', p_type,
    'changed_fields', v_diff, 'quoted_at', v_quoted_at, 'expires_at', v_expires_at);
end;
$$;

-- ------------------------------------------------ accept_order_revision() ----
-- The customer (or staff on their behalf) accepts the ISSUED quotation of a
-- Confirmed order and picks a payment plan and channel. No status change: the
-- order stays Confirmed until production starts (30% gate). Installment plans
-- set payment_exception_type, which queues an owner approval (001's gate).
drop function if exists public.accept_order_revision(uuid, uuid, int, numeric, numeric, numeric, text, public.confirmation_method, text, uuid, text);
create or replace function public.accept_order_revision(
  p_order_id uuid, p_revision_id uuid, p_expected_revision_number int,
  p_accepted_furniture_price numeric, p_accepted_delivery_fee numeric, p_accepted_total_amount numeric,
  p_client_idempotency_key text, p_method public.confirmation_method, p_confirmed_by_name text,
  p_recorded_by uuid default null, p_new_order_code text default null,
  p_payment_plan text default 'down_30',
  p_payment_method public.payment_method default null)
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
  if p_payment_plan is null or p_payment_plan not in ('down_30', 'installment', 'full') then
    raise exception 'VALIDATION: choose 30%% down payment, installment or full payment' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order not found' using errcode = 'P0001'; end if;

  select * into v_prior from public.order_confirmations
  where order_id = p_order_id and client_idempotency_key = v_key;
  if found then
    if v_prior.revision_id <> p_revision_id then
      raise exception 'IDEMPOTENCY_CONFLICT: this key was already used for a different revision' using errcode = 'P0001';
    end if;
    return jsonb_build_object('confirmation_id', v_prior.id, 'revision_id', v_prior.revision_id,
      'revision_number', v_prior.revision_number, 'duplicate', true);
  end if;

  if p_expected_revision_number is distinct from v_order.current_revision then
    raise exception 'STALE_REVISION: revision % is outdated; the latest is revision %', p_expected_revision_number, v_order.current_revision
      using errcode = 'P0001';
  end if;
  select * into v_rev from public.order_specification_revisions
  where revision_id = p_revision_id and order_id = p_order_id;
  if not found or v_rev.revision_number <> v_order.current_revision then
    raise exception 'STALE_REVISION: this is not the latest revision of the order' using errcode = 'P0001';
  end if;
  if v_rev.revision_type not in ('staff_draft', 'revised_quote') then
    raise exception 'PENDING_REVIEW: the shop must review this request and issue a quotation first' using errcode = 'P0001';
  end if;
  if v_order.status <> 'Confirmed' then
    raise exception 'INVALID_TRANSITION: only a confirmed order with an issued quotation can be accepted' using errcode = 'P0001';
  end if;
  if v_order.quotation_issued_at is null then
    raise exception 'PENDING_REVIEW: the shop has not issued the quotation yet' using errcode = 'P0001';
  end if;
  if v_order.specs_confirmed and v_order.approved_revision_number = v_rev.revision_number then
    raise exception 'ALREADY_ACCEPTED: this quotation was already accepted' using errcode = 'P0001';
  end if;
  if v_now > v_rev.expires_at then
    raise exception 'QUOTE_EXPIRED: this quotation expired on %; ask the shop for a fresh quotation', v_rev.expires_at
      using errcode = 'P0001';
  end if;
  if round(p_accepted_furniture_price, 2) is distinct from v_rev.quoted_furniture_price
     or round(p_accepted_delivery_fee, 2) is distinct from v_rev.quoted_delivery_fee
     or round(p_accepted_total_amount, 2) is distinct from round(v_rev.quoted_furniture_price + v_rev.quoted_delivery_fee, 2) then
    raise exception 'AMOUNT_MISMATCH: the accepted amounts do not match the quotation' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_exceptions_and_repairs e
             where e.order_id = p_order_id and e.status = 'Pending' and e.is_production_blocking) then
    raise exception 'PENDING_REVIEW: resolve the open specification review items for this order first' using errcode = 'P0001';
  end if;

  insert into public.order_confirmations (order_id, version_number, revision_number, revision_id, confirmed_specs_snapshot,
    confirmation_method, confirmed_by_name, recorded_by_staff_id, confirmed_at,
    specification_accepted_at, quotation_accepted_at, accepted_furniture_price, accepted_delivery_fee,
    accepted_total_amount, client_idempotency_key)
  values (p_order_id, v_rev.revision_number, v_rev.revision_number, v_rev.revision_id,
    private.spec_json(v_rev.furniture_category, v_rev.design_variant, v_rev.width_cm, v_rev.height_cm, v_rev.depth_cm,
      v_rev.wood_type, v_rev.custom_wood_note, v_rev.color_finish, v_rev.quantity,
      v_rev.quoted_furniture_price, v_rev.quoted_delivery_fee)
      || jsonb_build_object('item_name', v_order.item_name, 'dimensions', v_order.dimensions,
                            'furniture_price', v_rev.quoted_furniture_price, 'expires_at', v_rev.expires_at,
                            'payment_plan', p_payment_plan, 'payment_method', p_payment_method),
    p_method, coalesce(nullif(trim(p_confirmed_by_name), ''), v_order.customer_name), p_recorded_by, v_now,
    v_now, v_now, v_rev.quoted_furniture_price, v_rev.quoted_delivery_fee,
    round(v_rev.quoted_furniture_price + v_rev.quoted_delivery_fee, 2), v_key)
  returning id into v_conf;

  update public.orders set
    approved_revision_number = v_rev.revision_number, specs_confirmed = true,
    payment_plan = p_payment_plan, preferred_payment_method = p_payment_method,
    order_code = coalesce(p_new_order_code, order_code),
    payment_exception_type = case when p_payment_plan = 'installment' then 'Installment'::public.payment_exception_type
                                  else payment_exception_type end
  where id = p_order_id;

  return jsonb_build_object('confirmation_id', v_conf, 'revision_id', v_rev.revision_id,
    'revision_number', v_rev.revision_number, 'duplicate', false);
end;
$$;

-- -------------------------------------------------- claim_customer_orders ----
-- Called by the app server ONLY for a signed-in customer: a password exists only
-- after the owner completed a set-up link sent to that inbox, so signing in proves
-- ownership of the email. Links the orders the SHOP CONFIRMED and whose
-- confirmation email went to this account at that address, and records the email
-- as verified for them. Unconfirmed submissions, legacy orders and orders whose
-- email changed after confirmation are never linked. Service role only; idempotent.
create or replace function public.claim_customer_orders(p_user_id uuid)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_email   text;
  v_count   int;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found or v_profile.role <> 'customer' or not v_profile.is_active or v_profile.email is null then
    raise exception 'FORBIDDEN: not an active customer account' using errcode = '42501';
  end if;
  -- the auth system must also mark the inbox as confirmed (set-up link completed)
  select to_jsonb(u) ->> 'email_confirmed_at' into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'FORBIDDEN: the account email is not confirmed yet' using errcode = '42501';
  end if;
  -- only orders whose confirmation email was addressed to THIS account at THIS
  -- order's current email: legacy orders and later email edits are never auto-linked
  update public.orders o set customer_user_id = p_user_id, provisioning_status = 'linked',
    email_verified_at = coalesce(o.email_verified_at, now())
  where o.customer_user_id is null and not o.has_no_email and o.confirmed_at is not null
    and o.customer_email = lower(trim(v_profile.email))
    and exists (select 1 from public.notification_outbox n
                where n.order_id = o.id and n.customer_user_id = p_user_id and n.recipient_email = o.customer_email
                  and n.kind in ('order_confirmed_new_customer', 'order_confirmed_returning_customer'));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- --------------------------------------------------------- outbox kinds ------
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_chk;
alter table public.notification_outbox add constraint notification_outbox_kind_chk
  check (kind in ('quote_review_ready', 'order_confirmed_new_customer', 'order_confirmed_returning_customer',
                  'account_setup_link', 'quotation_payment_request'));

-- ------------------------------------------------ payment proof storage ------
-- Private bucket; only the app server (service role) reads or writes it. Staff
-- see a proof through a short-lived signed URL created on the server.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false;
  end if;
end $$;

-- ----------------------------------------------------- realtime feed (007) ----
-- Same function as 007; only the INSERT branch also flags new online orders.
create or replace function private.emit_order_live_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role   text := coalesce((select private.app_role())::text, 'system');
  v_stages text[] := array['Waiting for Confirmation', 'Confirmed', 'In Production', 'Completed / For Inspection',
                           'Ready for Delivery', 'Out for Delivery', 'Delivered'];
  v_order  public.orders;
  v_rec    jsonb;
  v_oid    uuid;
  v_trans  text;
begin
  if tg_table_name = 'orders' then
    if tg_op = 'DELETE' then
      insert into public.order_live_events (source, op, record_id, order_id, order_code, status, prev_status, actor_role, order_updated_at)
      values ('orders', 'DELETE', old.id, old.id, old.order_code, old.status, old.status, v_role, old.updated_at);
      return null;
    end if;
    if tg_op = 'INSERT' then
      -- a new online order (009: it starts as Waiting for Confirmation) alerts the shop
      v_trans := case when new.status = 'Quote Requested'
                        or (new.status = 'Waiting for Confirmation' and new.order_origin = 'customer_self_service')
                      then 'quote_requested' end;
      insert into public.order_live_events (source, op, record_id, order_id, order_code, status, prev_status, transition, actor_role, order_updated_at)
      values ('orders', 'INSERT', new.id, new.id, new.order_code, new.status, null, v_trans, v_role, new.updated_at);
      return null;
    end if;
    if new.status is distinct from old.status then
      if new.status = 'Confirmed' and old.status = 'Waiting for Confirmation'
         and exists (select 1 from public.order_confirmations c
                     where c.order_id = new.id and c.revision_number = new.approved_revision_number) then
        v_trans := 'quote_accepted';          -- committed confirmation for the ACTIVE revision
      elsif new.status::text = any (v_stages) and old.status::text = any (v_stages) then
        v_trans := 'stage_progress';          -- between the 7 main stages only
      end if;
    end if;
    insert into public.order_live_events (source, op, record_id, order_id, order_code, status, prev_status, transition, actor_role, order_updated_at)
    values ('orders', 'UPDATE', new.id, new.id, new.order_code, new.status, old.status, v_trans, v_role, new.updated_at);
    return null;
  end if;

  -- child tables: identify the order, never copy the child row's data
  v_rec := to_jsonb(coalesce(new, old));
  v_oid := (v_rec ->> 'order_id')::uuid;
  select * into v_order from public.orders where id = v_oid;
  if tg_table_name = 'payments' and tg_op <> 'DELETE' then
    if new.verified_by_owner_or_staff and (tg_op = 'INSERT' or not old.verified_by_owner_or_staff) then
      v_trans := 'payment_verified';        -- only once the owner/staff verification is committed
    end if;
  end if;
  insert into public.order_live_events (source, op, record_id, order_id, order_code, status, transition, payment_verified, actor_role, order_updated_at)
  values (tg_table_name, tg_op, coalesce((v_rec ->> 'id')::uuid, (v_rec ->> 'revision_id')::uuid), v_oid, v_order.order_code, v_order.status, v_trans,
          case when tg_table_name = 'payments' then (v_rec ->> 'verified_by_owner_or_staff')::boolean end,
          v_role, v_order.updated_at);
  return null;
end;
$$;
revoke all on function private.emit_order_live_event() from public;

-- ------------------------------------------------- workshop jobs (003) ----
-- Same function as 003; craftsmen no longer see confirmed orders whose quotation is still open.
create or replace function public.workshop_orders()
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
  where o.status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')
    -- 009: a Confirmed order reaches the workshop only once its quotation is accepted (the spec is final)
    and (o.status <> 'Confirmed' or o.specs_confirmed);
end;
$$;
revoke all on function public.workshop_orders() from public, anon;
grant execute on function public.workshop_orders() to authenticated, service_role;

-- ------------------------------------------------------------- privileges ----
revoke all on function public.accept_order_revision(uuid, uuid, int, numeric, numeric, numeric, text, public.confirmation_method, text, uuid, text, text, public.payment_method) from public, anon;
grant execute on function public.accept_order_revision(uuid, uuid, int, numeric, numeric, numeric, text, public.confirmation_method, text, uuid, text, text, public.payment_method) to authenticated, service_role;
revoke all on function public.claim_customer_orders(uuid) from public, anon, authenticated;
grant execute on function public.claim_customer_orders(uuid) to service_role;
revoke all on function private.payments_guard() from public;
