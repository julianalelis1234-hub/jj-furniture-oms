import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { addDays, todayISO } from "@/lib/domain/dates";
import type { Municipality, Order, OrderStatus, PaymentType, Profile, SpecRevision, WoodType } from "@/lib/domain/types";
import { WORKSHOP_STAGES } from "@/lib/domain/types";
import { dimensionsText, type FurnitureCategory } from "@/lib/domain/furniture";
import { MemoryStore, type MemoryTables } from "./memory-store";

/** Fixed staff IDs so demo sessions and Supabase seeding line up. */
export const STAFF = {
  owner: "11111111-1111-4111-8111-000000000001",
  gilbert: "11111111-1111-4111-8111-000000000002",
  liza: "11111111-1111-4111-8111-000000000003",
  nolito: "11111111-1111-4111-8111-000000000004",
  carlo: "11111111-1111-4111-8111-000000000005",
  dodong: "11111111-1111-4111-8111-000000000006",
  jesse: "11111111-1111-4111-8111-000000000007",
  rey: "11111111-1111-4111-8111-000000000008",
} as const;

/**
 * PRIVACY: every name, address and phone number below is fictional. Phone
 * numbers use the 0900-000-xxxx pattern so they cannot reach a real person.
 */
export const SEED_PROFILES: Omit<Profile, "created_at">[] = [
  { id: STAFF.owner, full_name: "Mr. Vincris Lelis", role: "owner", phone: "09000000001", is_active: true },
  { id: STAFF.gilbert, full_name: "Gilbert Decena", role: "staff", phone: "09000000002", is_active: true },
  { id: STAFF.liza, full_name: "Liza", role: "staff", phone: "09000000003", is_active: true },
  { id: STAFF.nolito, full_name: "Nolito Remulta", role: "craftsman", phone: "09000000004", is_active: true },
  { id: STAFF.carlo, full_name: "Carlo", role: "craftsman", phone: "09000000005", is_active: true },
  { id: STAFF.dodong, full_name: "Dodong", role: "craftsman", phone: "09000000006", is_active: true },
  { id: STAFF.jesse, full_name: "Jesse Decena", role: "driver", phone: "09000000007", is_active: true },
  { id: STAFF.rey, full_name: "Rey", role: "driver", phone: "09000000008", is_active: true },
];

/** Default demo actor per role (the persona shown in the wireframes). */
export const DEMO_PERSONA: Record<Profile["role"], string> = {
  owner: STAFF.owner,
  staff: STAFF.gilbert,
  craftsman: STAFF.nolito,
  driver: STAFF.jesse,
};

/** Demo customer login (fictional) — shown on /customer/login in Demo Mode only. */
export const DEMO_CUSTOMER_LOGIN = { email: "maria.santos@example.com", password: "Narra-Table-2026", name: "Maria Santos" };

/** Fictional customer emails (example.com is reserved for documentation). Walk-ins have none. */
const SEED_EMAIL: Record<string, string | "walk-in"> = {
  "JJ-2026-0145": DEMO_CUSTOMER_LOGIN.email,
  "DR-0148": "ramon.delacruz@example.com",
  "JJ-2026-0136": "bautista.family@example.com",
  "JJ-2026-0139": "jun.pacana@example.com",
  "JJ-2026-0141": "walk-in",
  "JJ-2026-0142": "rodel.aguilar@example.com",
  "JJ-2026-0137": "walk-in",
  "JJ-2026-0140": "benjie.saldivar@example.com",
  "JJ-2026-0143": "edgar.villanueva@example.com",
  "JJ-2026-0144": "jocelyn.tan@example.com",
  "JJ-2026-0134": "nestor.galarrita@example.com",
  "JJ-2026-0138": "mila.reyes@example.com",
};
/** Recorded before email authentication: keep their paper-slip PIN, no email on file. */
const LEGACY_PIN_ORDERS = new Set(["JJ-2026-0133", "JJ-2026-0130"]);

interface SeedOrder {
  code: string;
  slip: string;
  pin: string;
  customer: string;
  phone: string;
  address: string;
  municipality: Municipality;
  item: string;
  cat?: FurnitureCategory;
  variant?: string;
  w?: number;
  h?: number;
  d?: number;
  /** pre-configurator order: free-text dimensions only */
  legacy?: boolean;
  qty: number;
  dims: string;
  wood: WoodType;
  finish: string;
  notes?: string;
  photo?: string;
  price: number;
  fee: number;
  status: OrderStatus;
  rank?: number;
  label?: Order["priority_label"];
  craftsman?: string;
  terms?: Order["payment_exception_type"];
  termsApproved?: boolean;
  estDays: number;
  deliveryDays?: number;
  createdDaysAgo: number;
  encodedBy: string;
  payments?: { type: PaymentType; amount: number; method?: "Cash" | "GCash / Bank Transfer"; verified?: boolean; by?: string; daysAgo: number }[];
  revision?: boolean;
  /** "Other" wood: the species (Narra, Acacia, Molave …) */
  woodNote?: string;
  /** overrides SEED_EMAIL (fixtures) */
  email?: string | "walk-in";
  /** note on the latest status entry (e.g. a workshop sub-detail) */
  stageNote?: string;
}

const ORDERS: SeedOrder[] = [
  {
    code: "JJ-2026-0145", slip: "0145", pin: "4821", customer: "Maria Santos", phone: "09000000101",
    address: "Purok 5, Zone 2, Poblacion", municipality: "Valencia City", item: "6-Seater Classic Dining Table",
    cat: "Dining Table", variant: "6-Seater Classic", w: 210, h: 76, d: 90,
    qty: 1, dims: "", wood: "Mahogany", finish: "Walnut Stain",
    notes: "Rounded corners. Customer will pick up chairs separately.", price: 28500, fee: 0,
    status: "In Production", rank: 1, label: "Urgent", craftsman: STAFF.nolito, estDays: 3, deliveryDays: 5,
    createdDaysAgo: 12, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 8550, method: "GCash / Bank Transfer", daysAgo: 11 }],
  },
  {
    code: "DR-0148", slip: "0148", pin: "7314", customer: "Ramon dela Cruz", phone: "09000000102",
    address: "Brgy. Kaatuan, near chapel", municipality: "Lantapan", item: "Queen Bed Frame",
    cat: "Custom Piece", variant: "Bed Frame", w: 160, h: 110, d: 200,
    qty: 1, dims: "", wood: "Gmelina", finish: "Natural Varnish",
    price: 18000, fee: 800, status: "Waiting for Confirmation", estDays: 14, createdDaysAgo: 1, encodedBy: STAFF.liza,
  },
  {
    code: "JJ-2026-0136", slip: "0136", pin: "2468", customer: "Pedro & Ana Bautista", phone: "09000000103",
    address: "Purok 2, Brgy. Poblacion", municipality: "Cabanglasan", item: "3-1-1 Slatted Wooden Sala Set",
    cat: "Living Room Set", variant: "3-1-1 Slatted Wooden Set", w: 180, h: 85, d: 75,
    qty: 1, dims: "", wood: "Mahogany", finish: "Natural Varnish",
    price: 45000, fee: 1500, status: "Out for Delivery", rank: 4, craftsman: STAFF.carlo, estDays: -2, deliveryDays: 0,
    createdDaysAgo: 25, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 13500, daysAgo: 24 }],
  },
  {
    code: "JJ-2026-0133", slip: "0133", pin: "1357", customer: "Lourdes Ybañez", phone: "09000000104",
    address: "Sitio Lumbayao, Brgy. Lumbo", municipality: "Valencia City", item: "2-Door Wardrobe",
    legacy: true,
    qty: 1, dims: "180cm x 120cm x 60cm", wood: "Gmelina", finish: "White Paint",
    price: 16500, fee: 0, status: "Delivered", craftsman: STAFF.dodong, terms: "Credit / Pay Later", termsApproved: true,
    estDays: -6, deliveryDays: -3, createdDaysAgo: 30, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 4950, daysAgo: 29 }],
  },
  {
    code: "JJ-2026-0139", slip: "0139", pin: "5050", customer: "Jun Pacaña", phone: "09000000105",
    address: "Hagkol, near the public market", municipality: "Valencia City", item: "3-Door Base Counter Cabinet",
    cat: "Kitchen / Wall Cabinet", variant: "3-Door Base Counter", w: 150, h: 85, d: 55,
    qty: 1, dims: "", wood: "Mahogany", finish: "Natural Varnish",
    price: 12000, fee: 0, status: "Completed / For Inspection", rank: 3, label: "High", craftsman: STAFF.carlo,
    estDays: 0, deliveryDays: 2, createdDaysAgo: 15, encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 3600, daysAgo: 14 }],
  },
  {
    code: "JJ-2026-0141", slip: "0141", pin: "8080", customer: "Grace Lumayag", phone: "09000000999",
    address: "Brgy. Poblacion, beside Rural Health Unit", municipality: "Pangantucan", item: "2-Door Overhead Kitchen Cabinet",
    cat: "Kitchen / Wall Cabinet", variant: "2-Door Overhead", w: 120, h: 70, d: 35,
    qty: 1, dims: "", wood: "Gmelina", finish: "Natural Varnish",
    price: 32000, fee: 2000, status: "Confirmed", estDays: 18, createdDaysAgo: 5, encodedBy: STAFF.gilbert,
  },
  {
    code: "JJ-2026-0142", slip: "0142", pin: "3141", customer: "Rodel Aguilar", phone: "09000000107",
    address: "Purok 9, Brgy. Bagontaas", municipality: "Valencia City", item: "Classic 2-Panel Door",
    cat: "Panel Door", variant: "Classic 2-Panel", w: 80, h: 210, d: 4.5,
    qty: 2, dims: "", wood: "Mahogany", finish: "Dark Espresso",
    notes: "Owner inspection: lower panel joint on door #2 has a gap — re-glue and clamp.", price: 9000, fee: 0,
    status: "In Production", rank: 2, label: "High", craftsman: STAFF.dodong, estDays: 1, deliveryDays: 4,
    createdDaysAgo: 18, encodedBy: STAFF.gilbert, revision: true,
    payments: [{ type: "Down Payment (30%)", amount: 2700, daysAgo: 17 }],
  },
  {
    code: "JJ-2026-0137", slip: "0137", pin: "2718", customer: "Teresita Cabahug", phone: "09000000108",
    address: "Brgy. Halapitan, purok 1", municipality: "San Fernando", item: "Bookshelf / Room Divider",
    cat: "Custom Piece", variant: "Bookshelf / Divider", w: 120, h: 180, d: 35,
    qty: 1, dims: "", wood: "Mahogany", finish: "Dark Espresso",
    price: 14500, fee: 2500, status: "Ready for Delivery", craftsman: STAFF.nolito, estDays: -1, deliveryDays: 1,
    createdDaysAgo: 20, encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 4350, daysAgo: 19 }],
  },
  {
    code: "JJ-2026-0140", slip: "0140", pin: "6060", customer: "Benjie Saldivar", phone: "09000000109",
    address: "Purok 4, Brgy. Batangan", municipality: "Valencia City", item: "Bunk Bed Frame with Ladder",
    cat: "Custom Piece", variant: "Bed Frame", w: 90, h: 160, d: 190,
    qty: 1, dims: "", wood: "Gmelina", finish: "Gloss White",
    price: 21000, fee: 0, status: "Ready for Delivery", craftsman: STAFF.carlo, terms: "Installment",
    estDays: -1, createdDaysAgo: 22, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 6300, daysAgo: 21 }],
  },
  {
    code: "JJ-2026-0130", slip: "0130", pin: "9090", customer: "Analyn Moreno", phone: "09000000110",
    address: "Brgy. Lumbo, near barangay hall", municipality: "Valencia City", item: "Coffee Table",
    legacy: true,
    qty: 1, dims: "100cm x 60cm x 45cm", wood: "Mahogany", finish: "Clear Gloss",
    price: 7500, fee: 0, status: "Delivered", craftsman: STAFF.nolito, estDays: -4, deliveryDays: -1,
    createdDaysAgo: 28, encodedBy: STAFF.liza,
    payments: [
      { type: "Down Payment (30%)", amount: 2250, daysAgo: 27 },
      { type: "Delivery Balance Collection", amount: 5250, verified: false, by: STAFF.jesse, daysAgo: 1 },
    ],
  },
  {
    code: "JJ-2026-0143", slip: "0143", pin: "4242", customer: "Edgar Villanueva", phone: "09000000111",
    address: "Brgy. Songco", municipality: "Lantapan", item: "4-Seater Rectangular Dining Table",
    cat: "Dining Table", variant: "4-Seater Rectangular", w: 120, h: 76, d: 80,
    qty: 6, dims: "", wood: "Mahogany", finish: "Walnut Stain",
    notes: "Match the JJ-2026-0145 table stain.", price: 19800, fee: 800,
    status: "Confirmed", rank: 5, craftsman: STAFF.nolito, estDays: 9, createdDaysAgo: 6, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 5940, method: "GCash / Bank Transfer", daysAgo: 5 }],
  },
  {
    code: "JJ-2026-0144", slip: "0144", pin: "1212", customer: "Jocelyn Tan", phone: "09000000112",
    address: "Purok 1", municipality: "Valencia City", item: "Glass-Front Display Hutch",
    cat: "Kitchen / Wall Cabinet", variant: "Glass-Front Display Hutch", w: 150, h: 85, d: 40,
    qty: 1, dims: "", wood: "Gmelina", finish: "Walnut Stain",
    price: 11000, fee: 0, status: "Waiting for Confirmation", estDays: 12, createdDaysAgo: 2, encodedBy: STAFF.gilbert,
  },
  {
    code: "JJ-2026-0134", slip: "0134", pin: "5678", customer: "Nestor Galarrita", phone: "09000000113",
    address: "Brgy. Mendis, past the river crossing", municipality: "Pangantucan", item: "Glass-Front Display Cabinet",
    cat: "Kitchen / Wall Cabinet", variant: "Glass-Front Display Hutch", w: 100, h: 180, d: 40,
    qty: 1, dims: "", wood: "Mahogany", finish: "Walnut Stain",
    price: 17500, fee: 2000, status: "Ready for Delivery", craftsman: STAFF.dodong, estDays: -4, createdDaysAgo: 26,
    encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 5250, daysAgo: 25 }],
  },
  {
    code: "JJ-2026-0138", slip: "0138", pin: "1122", customer: "Mila Reyes", phone: "09000000114",
    address: "Purok 7, Brgy. Poblacion", municipality: "Valencia City", item: "Study Shelf / Divider",
    cat: "Custom Piece", variant: "Bookshelf / Divider", w: 120, h: 150, d: 60,
    qty: 1, dims: "", wood: "Gmelina", finish: "Natural Varnish",
    price: 8000, fee: 0, status: "Ready for Delivery", craftsman: STAFF.carlo, estDays: -2, deliveryDays: 0,
    createdDaysAgo: 19, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 2400, daysAgo: 18 }],
  },
];

const ts = (daysAgo: number, hour = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour - 8, 0, 0, 0); // hour in Manila (UTC+8)
  return d.toISOString();
};

/** Inserts staff-encoded seed orders (+ history, revision 1, confirmation, payments) through the MemoryStore. */
async function seedOrders(store: MemoryStore, list: SeedOrder[]) {
  const t = store.t;
  const today = todayISO();
  for (const s of list) {
    const email = s.email ?? SEED_EMAIL[s.code];
    const confirmed = s.status !== "Waiting for Confirmation";
    const order = await store.insertOrder({
      order_code: s.code,
      paper_slip_number: s.slip,
      encoded_by_id: s.encodedBy,
      customer_name: s.customer,
      customer_phone: s.phone,
      delivery_address: s.address,
      municipality: s.municipality,
      // historical data only: these slips were printed with a PIN before email login; nothing verifies it any more
      pin_code_hash: LEGACY_PIN_ORDERS.has(s.code) ? bcrypt.hashSync(s.pin, 6).replace(/^\$2b\$/, "$2a$") : null,
      pin_code_display: LEGACY_PIN_ORDERS.has(s.code) ? s.pin : null,
      customer_email: email && email !== "walk-in" ? email : null,
      has_no_email: !email || email === "walk-in",
      item_name: s.item,
      quantity: s.qty,
      dimensions: s.legacy ? s.dims : dimensionsText({ width_cm: s.w!, height_cm: s.h!, depth_cm: s.d! }),
      wood_type: s.wood,
      color_finish: s.finish,
      furniture_category: s.legacy ? null : s.cat!,
      design_variant: s.legacy ? null : s.variant!,
      width_cm: s.legacy ? null : s.w!,
      height_cm: s.legacy ? null : s.h!,
      depth_cm: s.legacy ? null : s.d!,
      custom_wood_note: s.woodNote ?? null,
      is_legacy_incomplete: !!s.legacy,
      special_instructions: s.notes ?? null,
      reference_photo_url: s.photo ?? null,
      specs_confirmed: confirmed,
      status: s.status,
      priority_rank: s.rank ?? 99,
      priority_label: s.label ?? "Normal",
      assigned_craftsman_id: s.craftsman ?? null,
      furniture_price: s.price,
      delivery_fee: s.fee,
      payment_exception_type: s.terms ?? "Standard 30/70",
      payment_exception_approved: s.termsApproved ?? false,
      estimated_completion_date: addDays(today, s.estDays),
      scheduled_delivery_date: s.deliveryDays === undefined ? null : addDays(today, s.deliveryDays),
    });
    const o = t.orders.find((x) => x.id === order.id)!;
    o.created_at = ts(s.createdDaysAgo);

    // status history up to the current stage
    const target = WORKSHOP_STAGES.indexOf(s.status as (typeof WORKSHOP_STAGES)[number]);
    let prev: string | null = null;
    for (let i = 0; i <= target; i++) {
      const when = ts(Math.max(0, s.createdDaysAgo - i * Math.max(1, Math.floor(s.createdDaysAgo / (target + 1)))), 9 + i);
      t.order_status_history.push({
        id: crypto.randomUUID(),
        order_id: o.id,
        from_status: prev,
        to_status: WORKSHOP_STAGES[i],
        changed_by_id: i <= 1 ? s.encodedBy : i <= 3 ? (s.craftsman ?? null) : i === 4 ? STAFF.owner : STAFF.jesse,
        notes: i === 0 ? `Encoded from paper slip #${s.slip}` : i === target && s.stageNote ? s.stageNote : i === 4 ? "Passed quality inspection" : null,
        client_transaction_id: null,
        changed_at: when,
      });
      prev = WORKSHOP_STAGES[i];
    }
    if (s.revision) {
      t.order_status_history.push(
        {
          id: crypto.randomUUID(), order_id: o.id, from_status: "In Production", to_status: "Completed / For Inspection",
          changed_by_id: s.craftsman ?? null, notes: "Marked ready for inspection", client_transaction_id: null, changed_at: ts(1, 10),
        },
        {
          id: crypto.randomUUID(), order_id: o.id, from_status: "Completed / For Inspection", to_status: "In Production",
          changed_by_id: STAFF.owner, notes: "Inspection failed: lower panel joint on door #2 has a gap.", client_transaction_id: null,
          changed_at: ts(1, 15),
        },
      );
    }

    // specification revision 1: the shop's quote (legacy orders keep their free-text dimensions)
    const rev1: SpecRevision = {
      revision_id: crypto.randomUUID(), order_id: o.id, revision_number: 1, revision_type: "staff_draft",
      furniture_category: o.furniture_category, design_variant: o.design_variant,
      width_cm: o.width_cm, height_cm: o.height_cm, depth_cm: o.depth_cm,
      wood_type: o.wood_type, custom_wood_note: o.custom_wood_note, color_finish: o.color_finish, quantity: o.quantity,
      legacy_dimensions_text: s.legacy ? o.dimensions : null,
      quoted_furniture_price: o.furniture_price, quoted_delivery_fee: o.delivery_fee,
      quoted_at: ts(s.createdDaysAgo), expires_at: new Date(Date.parse(ts(s.createdDaysAgo)) + 7 * 86_400_000).toISOString(),
      spec_preview_config: {}, changed_fields: s.legacy ? { backfill: "created from existing order by migration 003" } : {},
      created_by_role: s.legacy ? "system (migration 003 backfill)" : "staff", created_by_id: s.encodedBy,
      created_at: ts(s.createdDaysAgo),
    };
    t.order_specification_revisions.push(rev1);
    o.current_revision = 1;
    if (confirmed) {
      o.approved_revision_number = 1;
      t.order_confirmations.push({
        id: crypto.randomUUID(),
        order_id: o.id,
        version_number: 1,
        revision_number: 1,
        revision_id: rev1.revision_id,
        confirmed_specs_snapshot: {
          item_name: o.item_name, dimensions: o.dimensions, wood_type: o.wood_type, color_finish: o.color_finish,
          quantity: o.quantity, furniture_price: o.furniture_price!, furniture_category: o.furniture_category,
          design_variant: o.design_variant, width_cm: o.width_cm, height_cm: o.height_cm, depth_cm: o.depth_cm,
          quoted_furniture_price: o.furniture_price, quoted_delivery_fee: o.delivery_fee,
        },
        confirmation_method: s.createdDaysAgo % 2 ? "Signed Paper Slip" : "Messenger Reply",
        confirmed_by_name: s.customer,
        recorded_by_staff_id: s.encodedBy,
        confirmed_at: ts(s.createdDaysAgo - 1),
        specification_accepted_at: ts(s.createdDaysAgo - 1),
        quotation_accepted_at: ts(s.createdDaysAgo - 1),
        accepted_furniture_price: o.furniture_price!,
        accepted_delivery_fee: o.delivery_fee,
        accepted_total_amount: o.furniture_price! + o.delivery_fee,
        client_idempotency_key: null,
      });
    }

    for (const p of s.payments ?? []) {
      await store.insertPayment({
        order_id: o.id,
        client_transaction_id: crypto.randomUUID(),
        payment_type: p.type,
        amount: p.amount,
        payment_method: p.method ?? "Cash",
        collected_by_id: p.by ?? s.encodedBy,
        verified_by_owner_or_staff: p.verified ?? true,
        notes: p.verified === false ? "Cash collected on delivery — awaiting handover verification" : null,
        paid_at: ts(p.daysAgo),
      });
    }
    o.version = 1; // seed rows start fresh
  }
}

/**
 * Regression-test dataset (15 orders covering every edge case). Used by the
 * unit / E2E suites and by the demo when DEMO_DATASET=fixtures.
 */
export async function buildFixtureTables(): Promise<MemoryTables> {
  const store = new MemoryStore();
  const t = store.t;
  const today = todayISO();
  t.profiles = SEED_PROFILES.map((p) => ({ ...p, created_at: ts(90) }));
  await seedOrders(store, ORDERS);

  const byCode = (c: string) => t.orders.find((o) => o.order_code === c)!;

  // ---- deliveries
  const dl = (code: string, driver: string, vehicle: "Multicab" | "Elf Truck", days: number, window: string,
    status: "Scheduled" | "Out for Delivery" | "Delivered" | "Failed / Reschedule", notes: string | null = null) => {
    const o = byCode(code);
    t.delivery_assignments.push({
      id: crypto.randomUUID(), order_id: o.id, driver_id: driver, vehicle_type: vehicle, scheduled_date: addDays(today, days),
      time_window: window, delivery_fee: o.delivery_fee, expected_collectible_amount: o.collectible_on_delivery,
      dispatch_status: status, failure_or_damage_notes: notes, updated_at: ts(Math.max(0, -days)),
    });
  };
  dl("JJ-2026-0136", STAFF.jesse, "Elf Truck", 0, "8:00 AM - 11:00 AM", "Out for Delivery");
  dl("JJ-2026-0138", STAFF.jesse, "Multicab", 0, "1:00 PM - 3:00 PM", "Scheduled");
  dl("JJ-2026-0137", STAFF.rey, "Multicab", 1, "9:00 AM - 11:00 AM", "Scheduled");
  dl("JJ-2026-0133", STAFF.jesse, "Multicab", -3, "2:00 PM - 4:00 PM", "Delivered");
  dl("JJ-2026-0130", STAFF.jesse, "Multicab", -1, "10:00 AM - 12:00 PM", "Delivered");
  dl("JJ-2026-0134", STAFF.jesse, "Elf Truck", -1, "9:00 AM - 12:00 PM", "Failed / Reschedule",
    "Road to Brgy. Mendis flooded at river crossing. Small scratch on left door from rough road — needs painter touch-up before rescheduling.");
  // 0134 went out and came back
  const o134 = byCode("JJ-2026-0134");
  t.order_status_history.push(
    { id: crypto.randomUUID(), order_id: o134.id, from_status: "Ready for Delivery", to_status: "Out for Delivery", changed_by_id: STAFF.jesse, notes: "Trip started", client_transaction_id: null, changed_at: ts(1, 8) },
    { id: crypto.randomUUID(), order_id: o134.id, from_status: "Out for Delivery", to_status: "Ready for Delivery", changed_by_id: STAFF.jesse, notes: "Failed delivery: road flooded; scratch on left door", client_transaction_id: null, changed_at: ts(1, 12) },
  );

  // ---- exceptions / repairs
  const ex = (code: string, category: (typeof t.order_exceptions_and_repairs)[number]["category"], description: string,
    requested_by: string, status: "Pending" | "Approved" | "Resolved" = "Pending", daysAgo = 0) => {
    t.order_exceptions_and_repairs.push({
      id: crypto.randomUUID(), order_id: byCode(code).id, category, description, requested_by, status,
      is_production_blocking: category === "Spec Clarification",
      resolved_by_id: status === "Pending" ? null : STAFF.owner, created_at: ts(daysAgo, 11),
      resolved_at: status === "Pending" ? null : ts(daysAgo, 15),
    });
  };
  // 0140 installment approval was auto-created by the exception gate; 0133's credit is already approved:
  const credit = t.order_exceptions_and_repairs.find((e) => e.order_id === byCode("JJ-2026-0133").id);
  if (credit) Object.assign(credit, { status: "Approved", resolved_by_id: STAFF.owner, resolved_at: ts(28, 15) });
  ex("JJ-2026-0143", "Spec Clarification", "Tabletop thickness 3cm or 4.5cm? Slip only says \"thick top\".", "Nolito Remulta", "Pending", 0);
  ex("JJ-2026-0134", "On-Site Scratch Touch-Up / Repair", "Scratch on left door (approx. 8cm) from rough road. Painter touch-up with Cherry Stain before re-delivery.", "Jesse Decena", "Pending", 1);
  ex("JJ-2026-0137", "Special Delivery Terms", "Customer asks to deliver after 4 PM because nobody is home earlier. Halapitan road is unlit after 6 PM.", "Liza", "Pending", 0);

  // ---- Option 2: a customer self-service request waiting for its official quotation
  const req = await store.insertOrder({
    order_code: "DR-0147", paper_slip_number: null, encoded_by_id: null,
    customer_email: "josefina.lagura@example.com", has_no_email: false,
    customer_name: "Josefina Lagura", customer_phone: "09000000147",
    delivery_address: "Purok 5, Brgy. Bangcud, beside the barangay hall", municipality: "Lantapan",
    pin_code_hash: null, pin_code_display: null,
    item_name: "Wardrobe / Aparador Custom Piece", quantity: 1,
    dimensions: dimensionsText({ width_cm: 150, height_cm: 190, depth_cm: 60 }),
    wood_type: "Mahogany", color_finish: "Dark Espresso",
    furniture_category: "Custom Piece", design_variant: "Wardrobe / Aparador", width_cm: 150, height_cm: 190, depth_cm: 60,
    custom_wood_note: null, special_instructions: "Two hanging sections and three drawers at the bottom, please.",
    reference_photo_url: null, specs_confirmed: false, status: "Quote Requested", priority_rank: 99, priority_label: "Normal",
    assigned_craftsman_id: null, furniture_price: null, delivery_fee: 0, payment_exception_type: "Standard 30/70",
    payment_exception_approved: false, estimated_completion_date: null, scheduled_delivery_date: null,
    order_origin: "customer_self_service", client_request_key: "seed-request-0147",
  });
  await store.addSpecRevision({
    order_id: req.id, type: "customer_request", expected_revision: null, created_by_role: "customer", created_by_id: null,
    spec: { furniture_category: "Custom Piece", design_variant: "Wardrobe / Aparador", width_cm: 150, height_cm: 190, depth_cm: 60,
      wood_type: "Mahogany", custom_wood_note: null, color_finish: "Dark Espresso", quantity: 1 },
  });
  const reqRow = byCode("DR-0147");
  reqRow.created_at = ts(0, 8);
  reqRow.version = 1;
  t.order_specification_revisions.filter((r) => r.order_id === req.id).forEach((r) => (r.created_at = ts(0, 8)));
  t.order_status_history.push({
    id: crypto.randomUUID(), order_id: req.id, from_status: null, to_status: "Quote Requested", changed_by_id: null,
    notes: "Customer self-service request (Option 2) · specification revision 1", client_transaction_id: null, changed_at: ts(0, 8),
  });

  // ---- legacy rows: no email on file and not walk-ins (as migration 005 marks the live data)
  for (const code of LEGACY_PIN_ORDERS) Object.assign(byCode(code), { has_no_email: false, legacy_contact_unknown: true, provisioning_status: "not_applicable" });

  // ---- demo customer account: Maria verified her inbox for 0145 and set a password
  const maria = byCode("JJ-2026-0145");
  const mariaId = "c0000000-0000-4000-8000-000000000001";
  t.customer_accounts.push({
    id: mariaId, email: DEMO_CUSTOMER_LOGIN.email, full_name: DEMO_CUSTOMER_LOGIN.name, is_active: true, created_at: ts(20),
    password_hash: bcrypt.hashSync(DEMO_CUSTOMER_LOGIN.password, 6),
  });
  Object.assign(maria, { email_verified_at: ts(19), customer_user_id: mariaId, provisioning_status: "linked" });

  // ---- DR-0148: the quotation's single-use review link is waiting in Ramon's (simulated) inbox
  const ramon = byCode("DR-0148");
  const rev148 = t.order_specification_revisions.find((r) => r.order_id === ramon.id && r.revision_number === ramon.current_revision)!;
  const raw148 = randomBytes(32).toString("base64url");
  await store.issueReviewToken({ order_id: ramon.id, revision_id: rev148.revision_id, token_hash: createHash("sha256").update(raw148).digest("hex"), ttl_hours: 72 });
  t.demo_mailbox.push({
    id: crypto.randomUUID(), to: ramon.customer_email!, order_id: ramon.id, created_at: ts(1, 9),
    subject: `JJ Furniture quotation for ${ramon.order_code} — please review`,
    text: `Hello ${ramon.customer_name},\n\nYour quotation for ${ramon.item_name} is ready: ₱${ramon.furniture_price!.toLocaleString("en-PH")} furniture price + ₱${ramon.delivery_fee.toLocaleString("en-PH")} delivery.\n\nReview the exact specification and accept it here (single-use link):\n/customer/review?token=${raw148}\n\nIf you did not order from JJ Furniture, ignore this email.`,
  });

  // ---- notifications
  const nt = (code: string, body: string, status: "Sent" | "Failed" | "Pending", daysAgo: number, channel: "SMS" | "Messenger" = "SMS") => {
    const o = byCode(code);
    t.notifications.push({ id: crypto.randomUUID(), order_id: o.id, recipient_phone: o.customer_phone, channel, message_body: body, delivery_status: status, created_at: ts(daysAgo, 10) });
  };
  nt("JJ-2026-0145", "JJ Furniture: Your order JJ-2026-0145 (6-Seater Dining Table) is now In Production.", "Sent", 8);
  nt("JJ-2026-0136", "JJ Furniture: Your Sala Set (JJ-2026-0136) is out for delivery today. Please prepare ₱32,700.", "Sent", 0);
  nt("JJ-2026-0141", "JJ Furniture: Your specifications for JJ-2026-0141 are confirmed. Please settle the 30% down payment of ₱9,600.", "Failed", 2);
  nt("JJ-2026-0133", "JJ Furniture: JJ-2026-0133 delivered. Thank you!", "Sent", 3, "Messenger");

  return structuredClone(t);
}

// =============================================================================
// Curated Demo Mode dataset: exactly five active orders for JJ Furniture Shop
// and Enterprises (Valencia City, Bukidnon). DEMO DATA ONLY — production reads
// the real database and is never capped or seeded from here.
// PRIVACY: fictional contact details (example.com, 0900-000-xxxx).
// =============================================================================
export type DemoDataset = "curated" | "fixtures";
/** Demo Mode shows the curated five; the test suites start the server with DEMO_DATASET=fixtures. */
export const demoDataset = (): DemoDataset => (process.env.DEMO_DATASET === "fixtures" ? "fixtures" : "curated");

const DEMO_PASSWORD = "Narra-Table-2026";
export const CURATED_CUSTOMER_LOGIN = { email: "juliana.lelis@example.com", password: DEMO_PASSWORD, name: "Juliana Lelis" };
/** The one-click Demo Customer Login for the active dataset. */
export const demoCustomerLogin = () => (demoDataset() === "fixtures" ? DEMO_CUSTOMER_LOGIN : CURATED_CUSTOMER_LOGIN);

const CURATED: SeedOrder[] = [
  {
    code: "JJ-2026-1001", slip: "1001", pin: "", customer: "Juliana Lelis", phone: "09000001001", email: "juliana.lelis@example.com",
    address: "Purok 3, Brgy. Poblacion", municipality: "Valencia City", item: "Narra 6-Seater Dining Table",
    cat: "Dining Table", variant: "6-Seater Classic", w: 200, h: 76, d: 95, qty: 1, dims: "",
    wood: "Other", woodNote: "Narra", finish: "Natural Matte Varnish", notes: "Rounded table corners. Customer will pick up the bench separately.",
    price: 38500, fee: 0, status: "In Production", rank: 1, label: "High", craftsman: STAFF.nolito, estDays: 6, deliveryDays: 9,
    createdDaysAgo: 14, encodedBy: STAFF.gilbert, stageNote: "Timber joinery complete; surface sanding underway",
    payments: [{ type: "Down Payment (30%)", amount: 15000, method: "GCash / Bank Transfer", daysAgo: 12 }],
  },
  {
    code: "JJ-2026-1002", slip: "1002", pin: "", customer: "Rea Caday", phone: "09000001002", email: "rea.caday@example.com",
    address: "Purok 7, Brgy. Lumbo", municipality: "Valencia City", item: "Solid Mahogany King Platform Bed",
    cat: "Custom Piece", variant: "Bed Frame", w: 190, h: 110, d: 210, qty: 1, dims: "",
    wood: "Mahogany", finish: "Warm Espresso Stain", notes: "Low platform, no footboard.",
    price: 44000, fee: 0, status: "Waiting for Confirmation", estDays: 21, createdDaysAgo: 2, encodedBy: STAFF.liza,
  },
  {
    code: "JJ-2026-1004", slip: "1004", pin: "", customer: "Riezbell Naquinez", phone: "09000001004", email: "riezbell.naquinez@example.com",
    address: "Zone 1, Brgy. Poblacion (near the city plaza)", municipality: "Valencia City", item: "Acacia L-Shaped Executive Study Desk",
    cat: "Dining Table", variant: "4-Seater Rectangular", w: 160, h: 75, d: 140, qty: 1, dims: "",
    wood: "Other", woodNote: "Acacia", finish: "Natural Oil Finish", notes: "L-return on the right side; cable grommet at the back corner.",
    price: 24800, fee: 0, status: "Ready for Delivery", rank: 2, craftsman: STAFF.carlo, estDays: -1, deliveryDays: 1,
    createdDaysAgo: 24, encodedBy: STAFF.gilbert, stageNote: "Passed inspection; scheduled for Valencia City Poblacion drop-off",
    payments: [{ type: "Down Payment (30%)", amount: 10000, daysAgo: 22 }],
  },
  {
    code: "JJ-2026-1005", slip: "1005", pin: "", customer: "Bon Ortizano", phone: "09000001005", email: "walk-in",
    address: "Purok 2, Brgy. Bagontaas", municipality: "Valencia City", item: "Molave Accent Lounge Chair Pair",
    cat: "Living Room Set", variant: "Classic Curved Armrest Set", w: 72, h: 82, d: 78, qty: 2, dims: "",
    wood: "Other", woodNote: "Molave", finish: "Mocha Hand-Rubbed Finish", notes: "Walk-in order at the counter. Pair of matching chairs.",
    price: 19600, fee: 0, status: "Confirmed", estDays: 18, createdDaysAgo: 3, encodedBy: STAFF.gilbert,
  },
];

async function buildCuratedTables(): Promise<MemoryTables> {
  const store = new MemoryStore();
  const t = store.t;
  const today = todayISO();
  t.profiles = SEED_PROFILES.map((p) => ({ ...p, created_at: ts(90) }));
  await seedOrders(store, CURATED);
  const byCode = (c: string) => t.orders.find((o) => o.order_code === c)!;

  // JJ-2026-1003 — Option 2 self-service intake awaiting the shop's pricing (pre-quotation, not one of the 7 stages)
  const req = await store.insertOrder({
    order_code: "JJ-2026-1003", paper_slip_number: null, encoded_by_id: null,
    customer_email: "julian.marte@example.com", has_no_email: false,
    customer_name: "Julian Marte", customer_phone: "09000001003",
    delivery_address: "Purok 4, Brgy. Mailag", municipality: "Valencia City",
    pin_code_hash: null, pin_code_display: null,
    item_name: "Gmelina Modular Wardrobe Cabinet", quantity: 1,
    dimensions: dimensionsText({ width_cm: 180, height_cm: 210, depth_cm: 60 }),
    wood_type: "Gmelina", color_finish: "Satin Caramel Finish",
    furniture_category: "Custom Piece", design_variant: "Wardrobe / Aparador", width_cm: 180, height_cm: 210, depth_cm: 60,
    custom_wood_note: null, special_instructions: "Three modules: two hanging sections and one shelf tower with drawers.",
    reference_photo_url: null, specs_confirmed: false, status: "Quote Requested", priority_rank: 99, priority_label: "Normal",
    assigned_craftsman_id: null, furniture_price: null, delivery_fee: 0, payment_exception_type: "Standard 30/70",
    payment_exception_approved: false, estimated_completion_date: null, scheduled_delivery_date: null,
    order_origin: "customer_self_service", client_request_key: "seed-request-1003",
  });
  await store.addSpecRevision({
    order_id: req.id, type: "customer_request", expected_revision: null, created_by_role: "customer", created_by_id: null,
    spec: { furniture_category: "Custom Piece", design_variant: "Wardrobe / Aparador", width_cm: 180, height_cm: 210, depth_cm: 60,
      wood_type: "Gmelina", custom_wood_note: null, color_finish: "Satin Caramel Finish", quantity: 1 },
  });
  Object.assign(byCode("JJ-2026-1003"), { created_at: ts(0, 8), version: 1 });
  t.order_specification_revisions.filter((r) => r.order_id === req.id).forEach((r) => (r.created_at = ts(0, 8)));
  t.order_status_history.push({
    id: crypto.randomUUID(), order_id: req.id, from_status: null, to_status: "Quote Requested", changed_by_id: null,
    notes: "Customer self-service request (Option 2) · specification revision 1", client_transaction_id: null, changed_at: ts(0, 8),
  });
  // keep the table in creation order like the database
  t.orders.sort((a, b) => a.order_code.localeCompare(b.order_code));

  // verified customer accounts (Bon Ortizano is a walk-in: no email, no account, nothing linked)
  const accounts: [string, string, string, number][] = [
    ["JJ-2026-1001", "c0000000-0000-4000-8000-000000001001", "Juliana Lelis", 13],
    ["JJ-2026-1002", "c0000000-0000-4000-8000-000000001002", "Rea Caday", 1],
    ["JJ-2026-1003", "c0000000-0000-4000-8000-000000001003", "Julian Marte", 0],
    ["JJ-2026-1004", "c0000000-0000-4000-8000-000000001004", "Riezbell Naquinez", 23],
  ];
  const pw = bcrypt.hashSync(DEMO_PASSWORD, 6);
  for (const [code, id, name, daysAgo] of accounts) {
    const o = byCode(code);
    t.customer_accounts.push({ id, email: o.customer_email!, full_name: name, is_active: true, created_at: ts(daysAgo + 1), password_hash: pw });
    Object.assign(o, { email_verified_at: ts(daysAgo), customer_user_id: id, provisioning_status: "linked" });
  }

  // JJ-2026-1004 — scheduled Poblacion drop-off
  const d4 = byCode("JJ-2026-1004");
  t.delivery_assignments.push({
    id: crypto.randomUUID(), order_id: d4.id, driver_id: STAFF.jesse, vehicle_type: "Multicab", scheduled_date: addDays(today, 1),
    time_window: "9:00 AM - 11:00 AM", delivery_fee: d4.delivery_fee, expected_collectible_amount: d4.collectible_on_delivery,
    dispatch_status: "Scheduled", failure_or_damage_notes: null, updated_at: ts(0),
  });

  // JJ-2026-1002 — quotation Rev 1 issued; its single-use review link is in Rea's (simulated) inbox
  const rea = byCode("JJ-2026-1002");
  const rev = t.order_specification_revisions.find((r) => r.order_id === rea.id && r.revision_number === rea.current_revision)!;
  rev.quoted_at = ts(1, 9);
  rev.expires_at = new Date(Date.parse(ts(1, 9)) + 7 * 86_400_000).toISOString();
  const raw = randomBytes(32).toString("base64url");
  await store.issueReviewToken({ order_id: rea.id, revision_id: rev.revision_id, token_hash: createHash("sha256").update(raw).digest("hex"), ttl_hours: 72 });
  t.demo_mailbox.push({
    id: crypto.randomUUID(), to: rea.customer_email!, order_id: rea.id, created_at: ts(1, 9),
    subject: `Your JJ Furniture quotation for ${rea.order_code} is ready`,
    text: `Hello ${rea.customer_name},\n\nYour quotation for ${rea.item_name} is ready: ₱44,000.00 (free delivery in Valencia City).\n\nReview the exact specification and accept it here (single-use link):\n/customer/review?token=${raw}\n\nNothing is ordered or charged until you accept.`,
  });
  return structuredClone(t);
}

/** The Demo Mode dataset: the curated five by default, the regression fixtures when DEMO_DATASET=fixtures. */
export async function buildSeedTables(dataset: DemoDataset = demoDataset()): Promise<MemoryTables> {
  return dataset === "fixtures" ? buildFixtureTables() : buildCuratedTables();
}
