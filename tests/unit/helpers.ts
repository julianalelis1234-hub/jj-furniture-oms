import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeedTables, STAFF } from "@/lib/data/seed";
import { addDays, todayISO } from "@/lib/domain/dates";
import type { Actor } from "@/lib/domain/types";

export async function seededStore() {
  return new MemoryStore(await buildSeedTables());
}

export const actors = {
  owner: { id: STAFF.owner, role: "owner", full_name: "Mr. Vincris Lelis", source: "demo" },
  staff: { id: STAFF.gilbert, role: "staff", full_name: "Gilbert Decena", source: "demo" },
  craftsman: { id: STAFF.nolito, role: "craftsman", full_name: "Nolito Remulta", source: "demo" },
  driver: { id: STAFF.jesse, role: "driver", full_name: "Jesse Decena", source: "demo" },
  otherDriver: { id: STAFF.rey, role: "driver", full_name: "Rey", source: "demo" },
} satisfies Record<string, Actor>;

export function validOrderInput(overrides: Record<string, unknown> = {}) {
  const today = todayISO();
  return {
    paper_slip_number: `T-${Math.random().toString(36).slice(2, 8)}`,
    encoded_by_id: STAFF.gilbert,
    customer_name: "Juan Dela Cruz",
    customer_phone: "0900 000 0201",
    delivery_address: "Purok 3, Brgy. Poblacion, near the church",
    municipality: "Valencia City",
    item_name: "",
    quantity: "1",
    furniture_category: "Dining Table",
    design_variant: "4-Seater Rectangular",
    width_cm: "120",
    height_cm: "76",
    depth_cm: "80",
    wood_type: "Mahogany",
    custom_wood_note: "",
    color_finish: "Walnut Stain",
    special_instructions: "",
    reference_photo_url: "",
    furniture_price: "10000",
    delivery_fee: "0",
    payment_exception_type: "Standard 30/70",
    estimated_completion_date: addDays(today, 7),
    scheduled_delivery_date: "",
    ...overrides,
  };
}
