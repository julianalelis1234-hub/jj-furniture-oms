/**
 * Seeds a Supabase project with the Valencia City demo dataset.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_STAFF_PASSWORD=... \
 *     npx tsx scripts/seed-supabase.ts [--reset]
 *
 * - Creates one Supabase Auth user per staff member (fixed UUIDs from seed.ts)
 *   with email <slug>@SEED_EMAIL_DOMAIN and the given password.
 * - Inserts profiles and all sample orders, payments, history, deliveries,
 *   exceptions and notifications. Computed money columns are recomputed by
 *   the database triggers in 001_init.sql.
 * - --reset deletes existing orders first (cascades to all order data).
 *
 * Run it against a DEMO project only. Never commit the service-role key.
 */
import { createClient } from "@supabase/supabase-js";
import { buildSeedTables } from "../src/lib/data/seed";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_STAFF_PASSWORD;
const domain = process.env.SEED_EMAIL_DOMAIN ?? "jjfurniture.test";
if (!url || !key || !password || password.length < 10) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SEED_STAFF_PASSWORD (10+ chars).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const slug = (name: string) => name.toLowerCase().replace(/^mr\.\s*/, "").replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
const COMPUTED = ["standard_down_payment_due", "remaining_furniture_balance", "collectible_on_delivery", "version", "updated_at"];

async function must<T>(label: string, p: PromiseLike<{ error: { message: string } | null; data?: T }>) {
  const { error, data } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

async function main() {
  const t = await buildSeedTables();

  if (process.argv.includes("--reset")) {
    await must("reset orders", db.from("orders").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
    console.log("Deleted existing orders.");
  }

  for (const p of t.profiles) {
    const email = `${slug(p.full_name)}@${domain}`;
    const { error } = await db.auth.admin.createUser({ id: p.id, email, password, email_confirm: true, user_metadata: { full_name: p.full_name } });
    if (error && !/already|registered|exists/i.test(error.message)) throw new Error(`auth user ${email}: ${error.message}`);
    console.log(`staff login: ${email} (${p.role})`);
  }
  await must("profiles", db.from("profiles").upsert(t.profiles.map(({ id, full_name, role, phone, is_active }) => ({ id, full_name, role, phone, is_active }))));

  const orders = t.orders.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !COMPUTED.includes(k))));
  await must("orders", db.from("orders").insert(orders));
  // the exception-gate trigger re-creates installment approvals; use the seed's own rows instead
  await must("clear auto exceptions", db.from("order_exceptions_and_repairs").delete().eq("requested_by", "System (payment terms)"));

  await must("confirmations", db.from("order_confirmations").insert(t.order_confirmations));
  await must("payments", db.from("payments").insert(t.payments));
  await must("history", db.from("order_status_history").insert(t.order_status_history));
  await must("deliveries", db.from("delivery_assignments").insert(t.delivery_assignments));
  await must("exceptions", db.from("order_exceptions_and_repairs").insert(t.order_exceptions_and_repairs));
  await must("notifications", db.from("notifications").insert(t.notifications));
  console.log(`Seeded ${t.orders.length} orders. Customer PINs are on each order's printable slip.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
