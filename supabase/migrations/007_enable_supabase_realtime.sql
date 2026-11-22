-- =============================================================================
-- Migration 007: Supabase Realtime live sync (numbered 007: 006 is the PIN
-- removal migration). Idempotent; changes no existing grant or policy.
--
-- WHY A DEDICATED CHANGE FEED INSTEAD OF PUBLISHING THE OPERATIONAL TABLES
-- (inspected before writing this migration):
--   * Realtime postgres_changes applies RLS per ROW but always sends ALL
--     COLUMNS. Drivers may SELECT their assigned orders (orders_select_driver),
--     so publishing public.orders would stream furniture_price, internal
--     priority fields, staff ids etc. to drivers, and every column of a
--     customer's own order row to that customer.
--   * Craftsmen have NO policy on public.orders at all (they read the
--     workshop_orders() function), so they could not receive order changes.
--   * Customers have no policy on payments / confirmations / revisions.
--   * With the default replica identity an UPDATE payload carries no previous
--     row, so a client cannot prove a status TRANSITION from it.
-- So the operational tables are NOT added to supabase_realtime. Triggers write
-- one minimal, money-free row per change into public.order_live_events; that
-- row is published, and its own RLS (below) mirrors the existing authorization
-- of each role exactly. Clients treat a row only as a "something changed"
-- signal and then read authoritative data through the server, where the
-- existing RLS / service checks apply.
--
-- Payload columns: ids, order code, status before/after, a server-classified
-- transition, a payment "verified" flag (payments rows only, never shown to
-- craftsmen or drivers) and the acting ROLE. No amounts, notes, contacts,
-- emails, staff ids, verification evidence or tokens.
-- =============================================================================

create table if not exists public.order_live_events (
  id               bigint generated always as identity primary key,
  source           text not null check (source in ('orders', 'order_specification_revisions', 'order_confirmations', 'payments', 'delivery_assignments')),
  op               text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  record_id        uuid not null,
  order_id         uuid not null,          -- no FK: DELETE events must outlive the order
  order_code       text,
  status           public.order_status,    -- order status after the change
  prev_status      public.order_status,    -- order status before (orders UPDATE / DELETE)
  -- classified HERE, from committed database state; clients notify only on these
  transition       text check (transition in ('quote_requested', 'quote_accepted', 'stage_progress', 'payment_verified')),
  payment_verified boolean,                -- payments rows only
  actor_role       text not null default 'system',
  order_updated_at timestamptz,            -- orders.updated_at after the change (per-order ordering)
  occurred_at      timestamptz not null default clock_timestamp()
);
create index if not exists order_live_events_order_idx on public.order_live_events (order_id, id);
create index if not exists order_live_events_occurred_idx on public.order_live_events (occurred_at);

-- ------------------------------------------------------------- authorization ----
-- Supabase grants ALL on new public tables to anon/authenticated by default:
-- take that back, then allow exactly one thing (authenticated SELECT, filtered
-- by RLS). Rows are written only by the SECURITY DEFINER trigger function.
alter table public.order_live_events enable row level security;
revoke all on public.order_live_events from public, anon, authenticated;
grant select on public.order_live_events to authenticated;

-- customer ownership, evaluated at read time (an unlinked order stops being visible)
create or replace function private.is_order_customer(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.app_role()) = 'customer' and exists (
    select 1 from public.orders o where o.id = p_order_id and o.customer_user_id = (select auth.uid())
  )
$$;
revoke all on function private.is_order_customer(uuid) from public;
grant execute on function private.is_order_customer(uuid) to authenticated, service_role;

drop policy if exists live_events_office on public.order_live_events;
create policy live_events_office on public.order_live_events for select to authenticated
  using ((select private.is_office()));

-- customers: own orders only; order / confirmation signals and VERIFIED payments only
drop policy if exists live_events_customer on public.order_live_events;
create policy live_events_customer on public.order_live_events for select to authenticated
  using (source in ('orders', 'order_confirmations', 'payments')
         and (source <> 'payments' or payment_verified)
         and private.is_order_customer(order_id));

-- craftsmen: the same scope as workshop_orders() (workshop stages), order rows
-- only, and never a quotation event (the release to production is their signal)
drop policy if exists live_events_craftsman on public.order_live_events;
create policy live_events_craftsman on public.order_live_events for select to authenticated
  using ((select private.app_role()) = 'craftsman'
         and source = 'orders'
         and transition is distinct from 'quote_accepted'
         and (status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')
              or prev_status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery')));

-- drivers: orders they are assigned to (existing delivery_assignments rule):
-- assignment signals and DELIVERY-stage order signals only (RLS is evaluated at
-- read time, so earlier quotation / production history of a newly assigned
-- order stays invisible); never payments or confirmations
drop policy if exists live_events_driver on public.order_live_events;
create policy live_events_driver on public.order_live_events for select to authenticated
  using (private.is_assigned_driver(order_id)
         and (source = 'delivery_assignments'
              or (source = 'orders'
                  and (status in ('Ready for Delivery', 'Out for Delivery', 'Delivered')
                       or prev_status in ('Ready for Delivery', 'Out for Delivery', 'Delivered')))));

-- ------------------------------------------------------------------ triggers ----
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
      v_trans := case when new.status = 'Quote Requested' then 'quote_requested' end;
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

-- keep the feed short: Realtime and reconnect catch-up only need recent rows
create or replace function private.prune_order_live_events()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.order_live_events where occurred_at < now() - interval '7 days';
  return null;
end;
$$;
revoke all on function private.prune_order_live_events() from public;

drop trigger if exists orders_live_event on public.orders;
create trigger orders_live_event after insert or update or delete on public.orders
  for each row execute function private.emit_order_live_event();
drop trigger if exists spec_revisions_live_event on public.order_specification_revisions;
create trigger spec_revisions_live_event after insert on public.order_specification_revisions
  for each row execute function private.emit_order_live_event();
drop trigger if exists confirmations_live_event on public.order_confirmations;
create trigger confirmations_live_event after insert on public.order_confirmations
  for each row execute function private.emit_order_live_event();
drop trigger if exists payments_live_event on public.payments;
create trigger payments_live_event after insert or update on public.payments
  for each row execute function private.emit_order_live_event();
drop trigger if exists delivery_assignments_live_event on public.delivery_assignments;
create trigger delivery_assignments_live_event after insert or update or delete on public.delivery_assignments
  for each row execute function private.emit_order_live_event();
drop trigger if exists order_live_events_prune on public.order_live_events;
create trigger order_live_events_prune after insert on public.order_live_events
  for each statement execute function private.prune_order_live_events();

-- --------------------------------------------------------------- publication ----
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_live_events') then
    alter publication supabase_realtime add table public.order_live_events;
  end if;
end $$;
