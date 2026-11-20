import { addDays, todayISO } from "@/lib/domain/dates";
import { hashPin } from "@/lib/domain/pin";
import type { Municipality, Order, OrderStatus, PaymentType, Profile, WoodType } from "@/lib/domain/types";
import { ORDER_STATUSES } from "@/lib/domain/types";
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

/** Sample orders exposed as one-click buttons on the customer portal in Demo Mode. */
export const DEMO_CUSTOMER_SAMPLES = [
  { order_code: "JJ-2026-0145", pin: "4821", label: "Dining table · In Production" },
  { order_code: "DR-0148", pin: "7314", label: "Bed frame · Waiting for Confirmation" },
  { order_code: "JJ-2026-0136", pin: "2468", label: "Sala set · Out for Delivery" },
  { order_code: "JJ-2026-0133", pin: "1357", label: "Wardrobe · Delivered" },
];

interface SeedOrder {
  code: string;
  slip: string;
  pin: string;
  customer: string;
  phone: string;
  address: string;
  municipality: Municipality;
  item: string;
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
}

const ORDERS: SeedOrder[] = [
  {
    code: "JJ-2026-0145", slip: "0145", pin: "4821", customer: "Maria Santos", phone: "09000000101",
    address: "Purok 5, Zone 2, Poblacion", municipality: "Valencia City", item: "6-Seater Dining Table",
    qty: 1, dims: "210cm x 90cm x 4.5cm top", wood: "Mahogany", finish: "Dark Walnut Gloss",
    notes: "Rounded corners. Customer will pick up chairs separately.", price: 28500, fee: 0,
    status: "In Production", rank: 1, label: "Urgent", craftsman: STAFF.nolito, estDays: 3, deliveryDays: 5,
    createdDaysAgo: 12, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 8550, method: "GCash / Bank Transfer", daysAgo: 11 }],
  },
  {
    code: "DR-0148", slip: "0148", pin: "7314", customer: "Ramon dela Cruz", phone: "09000000102",
    address: "Brgy. Kaatuan, near chapel", municipality: "Lantapan", item: "Queen Bed Frame with Headboard",
    qty: 1, dims: "160cm x 200cm, headboard 110cm", wood: "Gmelina", finish: "Natural Matte",
    price: 18000, fee: 800, status: "Waiting for Confirmation", estDays: 14, createdDaysAgo: 1, encodedBy: STAFF.liza,
  },
  {
    code: "JJ-2026-0136", slip: "0136", pin: "2468", customer: "Pedro & Ana Bautista", phone: "09000000103",
    address: "Purok 2, Brgy. Poblacion", municipality: "Cabanglasan", item: "Sala Set (3-2-1 seater)",
    qty: 1, dims: "3-seater 200cm, 2-seater 140cm, single 80cm", wood: "Mahogany", finish: "Honey Oak Satin",
    price: 45000, fee: 1500, status: "Out for Delivery", rank: 4, craftsman: STAFF.carlo, estDays: -2, deliveryDays: 0,
    createdDaysAgo: 25, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 13500, daysAgo: 24 }],
  },
  {
    code: "JJ-2026-0133", slip: "0133", pin: "1357", customer: "Lourdes Ybañez", phone: "09000000104",
    address: "Sitio Lumbayao, Brgy. Lumbo", municipality: "Valencia City", item: "2-Door Wardrobe",
    qty: 1, dims: "180cm x 120cm x 60cm", wood: "Gmelina", finish: "White Paint",
    price: 16500, fee: 0, status: "Delivered", craftsman: STAFF.dodong, terms: "Credit / Pay Later", termsApproved: true,
    estDays: -6, deliveryDays: -3, createdDaysAgo: 30, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 4950, daysAgo: 29 }],
  },
  {
    code: "JJ-2026-0139", slip: "0139", pin: "5050", customer: "Jun Pacaña", phone: "09000000105",
    address: "Hagkol, near the public market", municipality: "Valencia City", item: "Office Desk with 3 Drawers",
    qty: 1, dims: "150cm x 75cm x 76cm", wood: "Mahogany", finish: "Clear Varnish",
    price: 12000, fee: 0, status: "Completed / For Inspection", rank: 3, label: "High", craftsman: STAFF.carlo,
    estDays: 0, deliveryDays: 2, createdDaysAgo: 15, encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 3600, daysAgo: 14 }],
  },
  {
    code: "JJ-2026-0141", slip: "0141", pin: "8080", customer: "Grace Lumayag", phone: "09000000999",
    address: "Brgy. Poblacion, beside Rural Health Unit", municipality: "Pangantucan", item: "Kitchen Cabinet Set (upper + lower)",
    qty: 1, dims: "Upper 240cm x 60cm x 35cm; Lower 240cm x 85cm x 55cm", wood: "Gmelina", finish: "Light Oak Satin",
    price: 32000, fee: 2000, status: "Confirmed", estDays: 18, createdDaysAgo: 5, encodedBy: STAFF.gilbert,
  },
  {
    code: "JJ-2026-0142", slip: "0142", pin: "3141", customer: "Rodel Aguilar", phone: "09000000107",
    address: "Purok 9, Brgy. Bagontaas", municipality: "Valencia City", item: "Rocking Chair",
    qty: 2, dims: "65cm x 95cm x 105cm", wood: "Mahogany", finish: "Dark Mahogany Stain",
    notes: "Owner inspection: armrest joint loose on chair #2 — re-glue and clamp.", price: 9000, fee: 0,
    status: "In Production", rank: 2, label: "High", craftsman: STAFF.dodong, estDays: 1, deliveryDays: 4,
    createdDaysAgo: 18, encodedBy: STAFF.gilbert, revision: true,
    payments: [{ type: "Down Payment (30%)", amount: 2700, daysAgo: 17 }],
  },
  {
    code: "JJ-2026-0137", slip: "0137", pin: "2718", customer: "Teresita Cabahug", phone: "09000000108",
    address: "Brgy. Halapitan, purok 1", municipality: "San Fernando", item: "Altar Table",
    qty: 1, dims: "120cm x 45cm x 90cm", wood: "Mahogany", finish: "Antique Brown",
    price: 14500, fee: 2500, status: "Ready for Delivery", craftsman: STAFF.nolito, estDays: -1, deliveryDays: 1,
    createdDaysAgo: 20, encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 4350, daysAgo: 19 }],
  },
  {
    code: "JJ-2026-0140", slip: "0140", pin: "6060", customer: "Benjie Saldivar", phone: "09000000109",
    address: "Purok 4, Brgy. Batangan", municipality: "Valencia City", item: "Bunk Bed with Ladder",
    qty: 1, dims: "90cm x 190cm, 160cm high", wood: "Gmelina", finish: "Navy Blue Paint",
    price: 21000, fee: 0, status: "Ready for Delivery", craftsman: STAFF.carlo, terms: "Installment",
    estDays: -1, createdDaysAgo: 22, encodedBy: STAFF.gilbert,
    payments: [{ type: "Installment / Partial", amount: 3000, daysAgo: 21 }],
  },
  {
    code: "JJ-2026-0130", slip: "0130", pin: "9090", customer: "Analyn Moreno", phone: "09000000110",
    address: "Brgy. Lumbo, near barangay hall", municipality: "Valencia City", item: "Coffee Table",
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
    address: "Brgy. Songco", municipality: "Lantapan", item: "Dining Chairs",
    qty: 6, dims: "45cm x 50cm x 95cm each", wood: "Mahogany", finish: "Dark Walnut Gloss",
    notes: "Match the JJ-2026-0145 table finish.", price: 19800, fee: 800,
    status: "Confirmed", rank: 5, craftsman: STAFF.nolito, estDays: 9, createdDaysAgo: 6, encodedBy: STAFF.gilbert,
    payments: [{ type: "Down Payment (30%)", amount: 5940, method: "GCash / Bank Transfer", daysAgo: 5 }],
  },
  {
    code: "JJ-2026-0144", slip: "0144", pin: "1212", customer: "Jocelyn Tan", phone: "09000000112",
    address: "Purok 1", municipality: "Valencia City", item: "TV Rack with Glass Doors",
    qty: 1, dims: "180cm x 40cm x 50cm", wood: "Gmelina", finish: "Walnut Stain",
    price: 11000, fee: 0, status: "Waiting for Confirmation", estDays: 12, createdDaysAgo: 2, encodedBy: STAFF.gilbert,
  },
  {
    code: "JJ-2026-0134", slip: "0134", pin: "5678", customer: "Nestor Galarrita", phone: "09000000113",
    address: "Brgy. Mendis, past the river crossing", municipality: "Pangantucan", item: "Display Cabinet",
    qty: 1, dims: "100cm x 40cm x 180cm", wood: "Mahogany", finish: "Cherry Stain",
    price: 17500, fee: 2000, status: "Ready for Delivery", craftsman: STAFF.dodong, estDays: -4, createdDaysAgo: 26,
    encodedBy: STAFF.liza,
    payments: [{ type: "Down Payment (30%)", amount: 5250, daysAgo: 25 }],
  },
  {
    code: "JJ-2026-0138", slip: "0138", pin: "1122", customer: "Mila Reyes", phone: "09000000114",
    address: "Purok 7, Brgy. Poblacion", municipality: "Valencia City", item: "Study Table with Hutch",
    qty: 1, dims: "120cm x 60cm x 150cm", wood: "Gmelina", finish: "Light Walnut",
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

/**
 * Builds the full demo dataset (relative to today) by going through the
 * MemoryStore so every computed field matches the database formulas.
 */
export async function buildSeedTables(): Promise<MemoryTables> {
  const store = new MemoryStore();
  const t = store.t;
  const today = todayISO();
  t.profiles = SEED_PROFILES.map((p) => ({ ...p, created_at: ts(90) }));

  for (const s of ORDERS) {
    const confirmed = s.status !== "Waiting for Confirmation";
    const order = await store.insertOrder({
      order_code: s.code,
      paper_slip_number: s.slip,
      encoded_by_id: s.encodedBy,
      customer_name: s.customer,
      customer_phone: s.phone,
      delivery_address: s.address,
      municipality: s.municipality,
      pin_code_hash: hashPin(s.pin, 6),
      pin_code_display: s.pin,
      item_name: s.item,
      quantity: s.qty,
      dimensions: s.dims,
      wood_type: s.wood,
      color_finish: s.finish,
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
    const target = ORDER_STATUSES.indexOf(s.status);
    let prev: string | null = null;
    for (let i = 0; i <= target; i++) {
      const when = ts(Math.max(0, s.createdDaysAgo - i * Math.max(1, Math.floor(s.createdDaysAgo / (target + 1)))), 9 + i);
      t.order_status_history.push({
        id: crypto.randomUUID(),
        order_id: o.id,
        from_status: prev,
        to_status: ORDER_STATUSES[i],
        changed_by_id: i <= 1 ? s.encodedBy : i <= 3 ? (s.craftsman ?? null) : i === 4 ? STAFF.owner : STAFF.jesse,
        notes: i === 0 ? `Encoded from paper slip #${s.slip}` : null,
        client_transaction_id: null,
        changed_at: when,
      });
      prev = ORDER_STATUSES[i];
    }
    if (s.revision) {
      t.order_status_history.push(
        {
          id: crypto.randomUUID(), order_id: o.id, from_status: "In Production", to_status: "Completed / For Inspection",
          changed_by_id: s.craftsman ?? null, notes: "Marked ready for inspection", client_transaction_id: null, changed_at: ts(1, 10),
        },
        {
          id: crypto.randomUUID(), order_id: o.id, from_status: "Completed / For Inspection", to_status: "In Production",
          changed_by_id: STAFF.owner, notes: "Inspection failed: armrest joint loose on chair #2.", client_transaction_id: null,
          changed_at: ts(1, 15),
        },
      );
    }

    if (confirmed) {
      t.order_confirmations.push({
        id: crypto.randomUUID(),
        order_id: o.id,
        version_number: 1,
        confirmed_specs_snapshot: {
          item_name: s.item, dimensions: s.dims, wood_type: s.wood, color_finish: s.finish, quantity: s.qty, furniture_price: s.price,
        },
        confirmation_method: s.createdDaysAgo % 2 ? "Signed Paper Slip" : "Messenger Reply",
        confirmed_by_name: s.customer,
        recorded_by_staff_id: s.encodedBy,
        confirmed_at: ts(s.createdDaysAgo - 1),
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
      resolved_by_id: status === "Pending" ? null : STAFF.owner, created_at: ts(daysAgo, 11),
      resolved_at: status === "Pending" ? null : ts(daysAgo, 15),
    });
  };
  // 0140 installment approval was auto-created by the exception gate; 0133's credit is already approved:
  const credit = t.order_exceptions_and_repairs.find((e) => e.order_id === byCode("JJ-2026-0133").id);
  if (credit) Object.assign(credit, { status: "Approved", resolved_by_id: STAFF.owner, resolved_at: ts(28, 15) });
  ex("JJ-2026-0143", "Spec Clarification", "Armrests on all 6 chairs, or only on the 2 head chairs? Slip only says \"with armrest\".", "Nolito Remulta", "Pending", 0);
  ex("JJ-2026-0134", "On-Site Scratch Touch-Up / Repair", "Scratch on left door (approx. 8cm) from rough road. Painter touch-up with Cherry Stain before re-delivery.", "Jesse Decena", "Pending", 1);
  ex("JJ-2026-0137", "Special Delivery Terms", "Customer asks to deliver after 4 PM because nobody is home earlier. Halapitan road is unlit after 6 PM.", "Liza", "Pending", 0);

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
