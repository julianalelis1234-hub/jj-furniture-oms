-- =============================================================================
-- Migration 002: security hardening (from the Supabase security advisor)
--  1. Customer RPCs are no longer callable by anon/authenticated directly.
--     Only the app server (service_role) calls them. Otherwise anyone could
--     call customer_verify_pin with a fresh p_client_key per guess and bypass
--     the per-client lockout. Adds a per-order lockout across all clients too.
--  2. Replaces the SECURITY DEFINER view workshop_orders with a function that
--     checks the caller's role explicitly (Supabase-recommended pattern).
-- =============================================================================

-- 1 ---------------------------------------------------------------------------
revoke execute on function public.customer_track(text) from anon, authenticated;
revoke execute on function public.customer_verify_pin(text, text, text) from anon, authenticated;
grant execute on function public.customer_track(text) to service_role;
grant execute on function public.customer_verify_pin(text, text, text) to service_role;

create or replace function public.customer_verify_pin(p_order_code text, p_pin text, p_client_key text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code            text := upper(trim(p_order_code));
  v_failures        int;
  v_order_failures  int;
  v_order           public.orders%rowtype;
  v_ok              boolean;
  c_max             constant int := 5;   -- per client per order
  c_order_max       constant int := 20;  -- per order, all clients (stops key rotation)
begin
  select count(*) filter (where a.client_key = p_client_key), count(*)
    into v_failures, v_order_failures
  from public.customer_pin_attempts a
  where a.order_code = v_code and not a.succeeded and a.attempted_at > now() - interval '15 minutes';

  if v_failures >= c_max or v_order_failures >= c_order_max then
    return jsonb_build_object('ok', false, 'locked', true, 'remaining_attempts', 0);
  end if;

  select * into v_order from public.orders o where o.order_code = v_code;
  v_ok := found and p_pin ~ '^\d{4}$'
          and v_order.pin_code_hash = extensions.crypt(p_pin, v_order.pin_code_hash);

  insert into public.customer_pin_attempts (order_code, client_key, succeeded)
  values (v_code, left(p_client_key, 100), coalesce(v_ok, false));

  if v_ok then
    return jsonb_build_object('ok', true, 'order_id', v_order.id);
  end if;
  return jsonb_build_object('ok', false, 'locked', v_failures + 1 >= c_max,
                            'remaining_attempts', greatest(0, c_max - v_failures - 1));
end;
$$;
revoke all on function public.customer_verify_pin(text, text, text) from public, anon, authenticated;
grant execute on function public.customer_verify_pin(text, text, text) to service_role;

-- 2 ---------------------------------------------------------------------------
drop view if exists public.workshop_orders;

create or replace function public.workshop_orders()
returns table (
  id uuid, order_code text, item_name text, quantity int, dimensions text,
  wood_type public.wood_type, color_finish text, special_instructions text,
  reference_photo_url text, status public.order_status, priority_rank int,
  priority_label public.priority_label, assigned_craftsman_id uuid,
  estimated_completion_date date, version int, updated_at timestamptz, needs_revision boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  -- Explicit role gate: only workshop/office staff; service_role (auth.uid() null) for the demo server.
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
    )
  from public.orders o
  where o.status in ('Confirmed', 'In Production', 'Completed / For Inspection', 'Ready for Delivery');
end;
$$;
revoke all on function public.workshop_orders() from public, anon;
grant execute on function public.workshop_orders() to authenticated, service_role;
