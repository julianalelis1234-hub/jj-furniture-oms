-- Migration 010: lumber stock items + append-only movement ledger, row-locked on-hand,
-- no negative stock, owner-only items / reorder levels, office-only access.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.check(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'TEST FAILED: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;
create or replace function pg_temp.expect_error(p_sql text, p_fragment text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_fragment in sqlerrm) > 0 then raise notice 'ok - %', p_msg; return; end if;
    raise exception 'TEST FAILED: % (unexpected error: %)', p_msg, sqlerrm;
  end;
  raise exception 'TEST FAILED: % (no error raised)', p_msg;
end $$;
create or replace function pg_temp.act_as(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false);
  execute 'set role authenticated';
end $$;
\set QUIET off

-- people (fresh ids so this file runs on any database)
insert into auth.users (id) values ('93000000-0000-0000-0000-000000000001'), ('93000000-0000-0000-0000-000000000002'),
  ('93000000-0000-0000-0000-000000000003') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  ('93000000-0000-0000-0000-000000000001', 'Owner T', 'owner'),
  ('93000000-0000-0000-0000-000000000002', 'Staff T', 'staff'),
  ('93000000-0000-0000-0000-000000000003', 'Craftsman T', 'craftsman') on conflict do nothing;

-- items: owner only, opening stock must be a movement
select pg_temp.act_as('93000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($q$insert into public.lumber_stock_items (wood_name, wood_type, reorder_level_bf) values ('Mahogany', 'Mahogany', 200)$q$,
  'OWNER_ONLY', 'staff cannot add lumber items');
reset role;
select pg_temp.act_as('93000000-0000-0000-0000-000000000001');
insert into public.lumber_stock_items (id, wood_name, wood_type, size_note, reorder_level_bf)
values ('94000000-0000-0000-0000-000000000001', 'Mahogany', 'Mahogany', '2" × 4" × 10 ft', 200);
select pg_temp.expect_error($q$insert into public.lumber_stock_items (wood_name, size_note, on_hand_bf) values ('Narra', '1" × 12" × 8 ft', 50)$q$,
  'receive movement', 'opening stock cannot be typed into the item');
select pg_temp.expect_error($q$insert into public.lumber_stock_items (wood_name, wood_type, size_note) values ('mahogany', 'Mahogany', '2" × 4" × 10 ft')$q$,
  'lumber_items_name_size_uidx', 'the same wood and size cannot be added twice');
reset role;

-- movements: staff receive and use; on-hand follows; never below zero
select pg_temp.act_as('93000000-0000-0000-0000-000000000002');
insert into public.lumber_movements (item_id, kind, board_feet, recorded_by, note)
values ('94000000-0000-0000-0000-000000000001', 'receive', 400, '93000000-0000-0000-0000-000000000002', 'Delivery from Bukidnon supplier');
insert into public.lumber_movements (item_id, kind, board_feet, recorded_by)
values ('94000000-0000-0000-0000-000000000001', 'use', 250, '93000000-0000-0000-0000-000000000002');
select pg_temp.check(on_hand_bf = 150 and on_hand_bf <= reorder_level_bf, 'received 400, used 250: 150 board feet on hand, at or below the reorder level')
from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$insert into public.lumber_movements (item_id, kind, board_feet, recorded_by) values ('94000000-0000-0000-0000-000000000001', 'use', 151, '93000000-0000-0000-0000-000000000002')$q$,
  'INSUFFICIENT_STOCK', 'using more than is on hand is refused');
select pg_temp.expect_error($q$insert into public.lumber_movements (item_id, kind, board_feet, recorded_by) values ('94000000-0000-0000-0000-000000000001', 'use', -10, '93000000-0000-0000-0000-000000000002')$q$,
  'lumber_movement_sign_chk', 'a use must be a positive amount');
select pg_temp.expect_error($q$insert into public.lumber_movements (item_id, kind, board_feet, recorded_by) values ('94000000-0000-0000-0000-000000000001', 'adjust', -5, '93000000-0000-0000-0000-000000000002')$q$,
  'lumber_adjust_note_chk', 'an adjustment needs a reason');
insert into public.lumber_movements (item_id, kind, board_feet, recorded_by, note)
values ('94000000-0000-0000-0000-000000000001', 'adjust', -5, '93000000-0000-0000-0000-000000000002', 'Stock count: 5 bf split boards');
select pg_temp.check(on_hand_bf = 145, 'a signed adjustment corrects the count (145)') from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$insert into public.lumber_movements (item_id, kind, board_feet, recorded_by) values ('94000000-0000-0000-0000-000000000001', 'receive', 10, '93000000-0000-0000-0000-000000000001')$q$,
  'row-level security', 'a movement is always recorded under the signed-in person');
-- direct edits of the stock or the ledger are refused
select pg_temp.expect_error($q$update public.lumber_stock_items set on_hand_bf = 9999 where id = '94000000-0000-0000-0000-000000000001'$q$,
  'only through receive', 'stock on hand cannot be typed over');
select pg_temp.expect_error($q$update public.lumber_stock_items set reorder_level_bf = 0 where id = '94000000-0000-0000-0000-000000000001'$q$,
  'OWNER_ONLY', 'staff cannot change the reorder level');
update public.lumber_movements set board_feet = 1; -- no update policy: matches no rows
delete from public.lumber_movements;              -- no delete policy: matches no rows
select pg_temp.check((select count(*) from public.lumber_movements where board_feet = 1) = 0 and (select count(*) from public.lumber_movements) = 3,
  'staff edits and deletes of the ledger change nothing (no policy)');
reset role;
-- even a privileged (service role) session cannot rewrite the ledger
select pg_temp.expect_error($q$update public.lumber_movements set board_feet = 1$q$, 'append-only', 'movements cannot be edited, even with elevated rights');
select pg_temp.expect_error($q$delete from public.lumber_movements$q$, 'append-only', 'movements cannot be deleted, even with elevated rights');

select pg_temp.act_as('93000000-0000-0000-0000-000000000001');
update public.lumber_stock_items set reorder_level_bf = 120 where id = '94000000-0000-0000-0000-000000000001';
select pg_temp.check(reorder_level_bf = 120, 'the owner changes the reorder level') from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001';
delete from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001'; -- no delete policy
reset role;
select pg_temp.check(exists (select 1 from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001'), 'the owner cannot delete an item (no policy)');
select pg_temp.expect_error($q$delete from public.lumber_stock_items where id = '94000000-0000-0000-0000-000000000001'$q$,
  'archive the item', 'items are archived, never deleted, even with elevated rights');

-- craftsmen (and every non-office role) see nothing
select pg_temp.act_as('93000000-0000-0000-0000-000000000003');
select pg_temp.check((select count(*) from public.lumber_stock_items) = 0 and (select count(*) from public.lumber_movements) = 0,
  'craftsmen cannot read the inventory');
select pg_temp.expect_error($q$insert into public.lumber_movements (item_id, kind, board_feet, recorded_by) values ('94000000-0000-0000-0000-000000000001', 'use', 1, '93000000-0000-0000-0000-000000000003')$q$,
  'row-level security', 'craftsmen cannot record movements');
reset role;
select pg_temp.check(not has_table_privilege('anon', 'public.lumber_stock_items', 'select'), 'anon has no access to the inventory');

\echo 'PASSED: 13_lumber_inventory'
