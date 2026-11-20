/** Emits SQL that loads the demo dataset into a database migrated with 001_init.sql
 *  (used by scripts/test-db.sh to cross-check DB triggers against the TS engine). */
import { buildSeedTables } from "../src/lib/data/seed";

const q = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const COMPUTED = ["standard_down_payment_due", "remaining_furniture_balance", "collectible_on_delivery", "version", "updated_at"];

buildSeedTables().then((t) => {
  const orders = t.orders.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !COMPUTED.includes(k))));
  const out = [
    `insert into auth.users (id) select (x->>'id')::uuid from jsonb_array_elements(${q(t.profiles)}) x;`,
    `insert into public.profiles (id, full_name, role, phone, is_active) select id, full_name, role, phone, is_active from jsonb_populate_recordset(null::public.profiles, ${q(t.profiles)});`,
    `insert into public.orders (${Object.keys(orders[0]).join(",")}) select ${Object.keys(orders[0]).join(",")} from jsonb_populate_recordset(null::public.orders, ${q(orders)});`,
    `delete from public.order_exceptions_and_repairs where requested_by = 'System (payment terms)';`,
    ...(["order_confirmations", "payments", "order_status_history", "delivery_assignments", "order_exceptions_and_repairs", "notifications"] as const).map(
      (tbl) => `insert into public.${tbl} select * from jsonb_populate_recordset(null::public.${tbl}, ${q(t[tbl])});`,
    ),
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
