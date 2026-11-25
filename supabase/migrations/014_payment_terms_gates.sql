-- 014: payment rules follow the customer's payment terms.
--   * 30% down payment (and orders without terms): the verified 30% before production and dispatch (unchanged)
--   * Full payment: the whole furniture price, verified, before production and dispatch
--   * Installment: no down payment; the owner's approval of the installment plan
--     (payment_exception_approved, set when the owner approves the Installment Approval item)
-- An owner-approved payment exception still lifts the amount rule. Only the payment
-- checks of private.orders_before_write() change; everything else is as in 009b.
-- Non-destructive: replaces one function body, no data or columns change.

create or replace function private.orders_before_write()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_furniture_paid numeric(10,2);
  v_fee_paid       numeric(10,2);
  v_overflow       numeric(10,2);
  v_price          numeric(10,2);
  v_required       numeric(10,2);
  v_when           text;
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
    end if;

    -- payment rules by the customer's terms (014): before production and before dispatch
    if (new.status = 'In Production' and old.status = 'Confirmed') or new.status = 'Out for Delivery' then
      v_when := case when new.status = 'In Production' then 'production' else 'dispatch' end;
      if new.payment_plan = 'installment' then
        if not new.payment_exception_approved then
          raise exception 'DOWN_PAYMENT_REQUIRED: the owner must approve the installment plan before %', v_when
            using errcode = 'P0001';
        end if;
      elsif not new.payment_exception_approved then
        v_required := case when new.payment_plan = 'full' then v_price else new.standard_down_payment_due end;
        if v_furniture_paid < v_required then
          if new.payment_plan = 'full' then
            raise exception 'DOWN_PAYMENT_REQUIRED: the full payment (%) must be verified before %; verified so far: %',
              v_required, v_when, v_furniture_paid using errcode = 'P0001';
          elsif v_when = 'production' then
            raise exception 'DOWN_PAYMENT_REQUIRED: a verified 30%% down payment (%) is required before production; verified so far: %',
              v_required, v_furniture_paid using errcode = 'P0001';
          else
            raise exception 'DOWN_PAYMENT_REQUIRED: 30%% down payment or an owner-approved exception is required before dispatch'
              using errcode = 'P0001';
          end if;
        end if;
      end if;
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
$function$;
