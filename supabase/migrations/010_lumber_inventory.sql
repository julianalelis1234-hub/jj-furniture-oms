-- 010 · Lumber & Inventory (JJ Enterprises is a lumber dealer as well as a furniture shop)
--
-- lumber_stock_items : one row per timber the shop stocks (wood, size note, reorder level)
-- lumber_movements   : an append-only ledger of board feet received, used or adjusted
-- on_hand_bf is maintained ONLY by the movement trigger, under a row lock, and can
-- never go below zero. Owner and staff read and record; only the owner adds items
-- or changes reorder levels. Craftsmen, drivers and customers have no access.
--
-- Re-runnable. Never edits migrations 001-009.

create table if not exists public.lumber_stock_items (
  id             uuid primary key default gen_random_uuid(),
  wood_name      text not null check (length(trim(wood_name)) between 2 and 60),
  wood_type      public.wood_type not null default 'Other',
  size_note      text check (size_note is null or length(size_note) <= 60),   -- e.g. 2" × 4" × 10 ft
  reorder_level_bf numeric(12,2) not null default 0 check (reorder_level_bf >= 0),
  on_hand_bf     numeric(12,2) not null default 0 check (on_hand_bf >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists lumber_items_name_size_uidx
  on public.lumber_stock_items (lower(wood_name), coalesce(lower(size_note), ''));

create table if not exists public.lumber_movements (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.lumber_stock_items (id),
  kind         text not null check (kind in ('receive', 'use', 'adjust')),
  -- receive / use: a positive amount; adjust: a signed correction (stock count)
  board_feet   numeric(12,2) not null check (board_feet <> 0 and abs(board_feet) <= 100000),
  order_id     uuid references public.orders (id) on delete set null,
  note         text check (note is null or length(note) <= 300),
  recorded_by  uuid references public.profiles (id),
  client_transaction_id uuid unique,
  created_at   timestamptz not null default now(),
  constraint lumber_movement_sign_chk check (kind = 'adjust' or board_feet > 0),
  constraint lumber_adjust_note_chk check (kind <> 'adjust' or length(trim(coalesce(note, ''))) > 0)
);
create index if not exists lumber_movements_item_idx on public.lumber_movements (item_id, created_at desc);
create index if not exists lumber_movements_order_idx on public.lumber_movements (order_id) where order_id is not null;
create index if not exists lumber_movements_recorded_by_idx on public.lumber_movements (recorded_by);

-- ---------------------------------------------------- stock maintenance ----
create or replace function private.lumber_apply_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_item  public.lumber_stock_items%rowtype;
  v_delta numeric(12,2) := case new.kind when 'use' then -new.board_feet else new.board_feet end;
begin
  select * into v_item from public.lumber_stock_items where id = new.item_id for update;
  if not found then raise exception 'NOT_FOUND: lumber item not found' using errcode = 'P0001'; end if;
  if not v_item.is_active then raise exception 'VALIDATION: this lumber item is archived' using errcode = 'P0001'; end if;
  if v_item.on_hand_bf + v_delta < 0 then
    raise exception 'INSUFFICIENT_STOCK: only % board feet of % on hand', v_item.on_hand_bf, v_item.wood_name using errcode = 'P0001';
  end if;
  update public.lumber_stock_items set on_hand_bf = on_hand_bf + v_delta, updated_at = now() where id = new.item_id;
  return new;
end; $$;
drop trigger if exists lumber_movements_apply on public.lumber_movements;
create trigger lumber_movements_apply before insert on public.lumber_movements
  for each row execute function private.lumber_apply_movement();

-- the ledger is append-only: corrections are new 'adjust' rows
create or replace function private.lumber_movements_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_RECORD: lumber movements are append-only; record an adjustment instead' using errcode = '42501';
end; $$;
drop trigger if exists lumber_movements_immutable on public.lumber_movements;
create trigger lumber_movements_immutable before update or delete on public.lumber_movements
  for each row execute function private.lumber_movements_immutable();

-- on_hand_bf changes only through movements; reorder levels and items are owner decisions
create or replace function private.lumber_items_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_role public.app_role := (select private.app_role());
begin
  if tg_op = 'INSERT' then
    if new.on_hand_bf <> 0 then raise exception 'VALIDATION: opening stock is recorded as a receive movement' using errcode = 'P0001'; end if;
    if v_role is not null and v_role <> 'owner' then raise exception 'OWNER_ONLY: only the owner adds lumber items' using errcode = '42501'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then raise exception 'IMMUTABLE_RECORD: archive the item instead of deleting it' using errcode = '42501'; end if;
  -- the movement trigger (security definer, no JWT role inside) is the only writer of on_hand_bf
  if new.on_hand_bf is distinct from old.on_hand_bf and pg_trigger_depth() < 2 then
    raise exception 'IMMUTABLE_RECORD: stock on hand changes only through receive / use / adjust entries' using errcode = '42501';
  end if;
  if (new.reorder_level_bf, new.wood_name, new.wood_type, new.size_note, new.is_active)
     is distinct from (old.reorder_level_bf, old.wood_name, old.wood_type, old.size_note, old.is_active)
     and v_role is not null and v_role <> 'owner' then
    raise exception 'OWNER_ONLY: only the owner changes lumber items and reorder levels' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end; $$;
drop trigger if exists lumber_items_guard on public.lumber_stock_items;
create trigger lumber_items_guard before insert or update or delete on public.lumber_stock_items
  for each row execute function private.lumber_items_guard();

-- ------------------------------------------------------------------- RLS ----
alter table public.lumber_stock_items enable row level security;
alter table public.lumber_movements enable row level security;
revoke all on public.lumber_stock_items, public.lumber_movements from anon;

drop policy if exists lumber_items_office_select on public.lumber_stock_items;
create policy lumber_items_office_select on public.lumber_stock_items for select to authenticated
  using ((select private.is_office()));
drop policy if exists lumber_items_owner_insert on public.lumber_stock_items;
create policy lumber_items_owner_insert on public.lumber_stock_items for insert to authenticated
  with check ((select private.app_role()) = 'owner');
drop policy if exists lumber_items_office_update on public.lumber_stock_items;
-- staff may update rows only in the ways the guard allows (nothing but on_hand via movements)
create policy lumber_items_office_update on public.lumber_stock_items for update to authenticated
  using ((select private.is_office())) with check ((select private.is_office()));

drop policy if exists lumber_movements_office_select on public.lumber_movements;
create policy lumber_movements_office_select on public.lumber_movements for select to authenticated
  using ((select private.is_office()));
drop policy if exists lumber_movements_office_insert on public.lumber_movements;
create policy lumber_movements_office_insert on public.lumber_movements for insert to authenticated
  with check ((select private.is_office()) and recorded_by = (select auth.uid()));

revoke all on function private.lumber_apply_movement() from public;
revoke all on function private.lumber_movements_immutable() from public;
revoke all on function private.lumber_items_guard() from public;
