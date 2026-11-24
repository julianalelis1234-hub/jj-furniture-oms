/** Emits SQL that loads the demo dataset into a database migrated with 001_init.sql
 *  (used by scripts/test-db.sh to cross-check DB triggers against the TS engine). */
import { buildSeedTables } from "../src/lib/data/seed";

const q = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const COMPUTED = ["standard_down_payment_due", "remaining_furniture_balance", "collectible_on_delivery", "version", "updated_at"];

buildSeedTables(process.argv.includes("--curated") ? "curated" : "fixtures").then((t) => {
  const orders = t.orders.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !COMPUTED.includes(k))));
  const out = [
    process.argv.includes("--supabase")
      ? // Real Supabase auth.users rows. Password is random and unknown: nobody can sign in
        // until the owner sets a real password (dashboard) or runs npm run db:seed.
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           confirmation_token, recovery_token, email_change_token_new, email_change)
         select '00000000-0000-0000-0000-000000000000', (x->>'id')::uuid, 'authenticated', 'authenticated',
           x->>'email', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
           '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', x->>'full_name'), now(), now(), '', '', '', ''
         from jsonb_array_elements(${q(t.profiles.map((p) => ({ id: p.id, full_name: p.full_name, email: `${p.full_name.toLowerCase().replace(/^mr\.\s*/, "").replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@jjfurniture.test` })))}) x
         on conflict (id) do nothing;`
      : `insert into auth.users (id) select (x->>'id')::uuid from jsonb_array_elements(${q(t.profiles)}) x;`,
    `insert into public.profiles (id, full_name, role, phone, is_active) select id, full_name, role, phone, is_active from jsonb_populate_recordset(null::public.profiles, ${q(t.profiles)});`,
    // demo customer logins: auth user + 'customer' profile (no password is loaded into the database)
    `insert into auth.users (id) select (x->>'id')::uuid from jsonb_array_elements(${q(t.customer_accounts.map((a) => ({ id: a.id })))}) x on conflict do nothing;`,
    `insert into public.profiles (id, full_name, role, email, is_active) select (x->>'id')::uuid, x->>'full_name', 'customer', x->>'email', true from jsonb_array_elements(${q(t.customer_accounts.map((a) => ({ id: a.id, full_name: a.full_name, email: a.email })))}) x;`,
    // the seed reproduces historical legacy rows, which the insert guard (correctly) refuses to create for new orders
    `alter table public.orders disable trigger orders_email_guard;`,
    `insert into public.orders (${Object.keys(orders[0]).join(",")}) select ${Object.keys(orders[0]).join(",")} from jsonb_populate_recordset(null::public.orders, ${q(orders)});`,
    `alter table public.orders enable trigger orders_email_guard;`,
    `delete from public.order_exceptions_and_repairs where requested_by = 'System (payment terms)';`,
    ...(["order_specification_revisions", "order_confirmations", "payments", "order_status_history", "delivery_assignments", "order_exceptions_and_repairs", "notifications", "quote_review_tokens"] as const).map(
      (tbl) => `insert into public.${tbl} select * from jsonb_populate_recordset(null::public.${tbl}, ${q(t[tbl])});`,
    ),
    // lumber (migration 010): items start at 0; the movement trigger rebuilds on-hand, which must equal the TS engine's
    `insert into public.lumber_stock_items select * from jsonb_populate_recordset(null::public.lumber_stock_items, ${q(t.lumber_stock_items.map((i) => ({ ...i, on_hand_bf: 0 })))});`,
    `insert into public.lumber_movements select * from jsonb_populate_recordset(null::public.lumber_movements, ${q([...t.lumber_movements].sort((a, b) => a.created_at.localeCompare(b.created_at)))}) order by created_at;`,
    `do $$ declare n int; begin
       select count(*) into n from jsonb_to_recordset(${q(t.lumber_stock_items.map((i) => ({ id: i.id, on_hand: i.on_hand_bf })))}) as x(id uuid, on_hand numeric)
         join public.lumber_stock_items l on l.id = x.id where l.on_hand_bf <> x.on_hand;
       if n > 0 then raise exception 'TEST FAILED: % lumber item(s) differ between the DB ledger and the TS engine', n; end if;
       raise notice 'ok - lumber ledger replays into the real schema; on-hand board feet match the TS engine for % items', (select count(*) from public.lumber_stock_items);
     end $$;`,
    `create temp table expected as select * from jsonb_to_recordset(${q(t.orders.map((o) => ({ code: o.order_code, collectible: o.collectible_on_delivery, remaining: o.remaining_furniture_balance, down: o.standard_down_payment_due, fee: o.delivery_fee })))}) as x(code text, collectible numeric, remaining numeric, down numeric, fee numeric);`,
    `do $$ declare n int; begin
       select count(*) into n from expected e join public.orders o on o.order_code = e.code
        where o.collectible_on_delivery <> e.collectible or o.remaining_furniture_balance <> e.remaining
           or o.standard_down_payment_due <> e.down or o.delivery_fee <> e.fee;
       if n > 0 then raise exception 'TEST FAILED: % order(s) differ between DB triggers and TS engine', n; end if;
       raise notice 'ok - seed loads into the real schema and DB-computed balances match the TS engine for % orders', (select count(*) from expected);
     end $$;`,
  ];
  console.log(out.join("\n"));
});
