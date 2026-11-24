import { z } from "zod";
import type { DataStore } from "@/lib/data/store";
import { DomainError } from "@/lib/domain/errors";
import { money } from "@/lib/domain/finance";
import { LUMBER_MOVEMENT_KINDS, WOOD_TYPES, type Actor, type LumberItem, type LumberMovement } from "@/lib/domain/types";
import { ensureRole } from "./guard";

/** Board feet = thickness (in) × width (in) × length (ft) ÷ 12, per piece. Centavo-style rounding (2 dp). */
export function boardFeet(thicknessIn: number, widthIn: number, lengthFt: number, pieces = 1): number {
  return money((thicknessIn * widthIn * lengthFt * pieces) / 12);
}

export type StockLevel = "out" | "low" | "ok";
export function stockLevel(i: Pick<LumberItem, "on_hand_bf" | "reorder_level_bf">): StockLevel {
  if (i.on_hand_bf <= 0) return "out";
  return i.on_hand_bf <= i.reorder_level_bf ? "low" : "ok";
}

export interface InventorySummary {
  items: (LumberItem & { level: StockLevel })[];
  lowStock: (LumberItem & { level: StockLevel })[];
  totalOnHandBf: number;
  /** board feet received / used in the last 30 days */
  received30: number;
  used30: number;
}

export function inventorySummary(items: LumberItem[], movements: LumberMovement[], now = Date.now()): InventorySummary {
  const active = items.filter((i) => i.is_active).map((i) => ({ ...i, level: stockLevel(i) }));
  const since = now - 30 * 86_400_000;
  const recent = movements.filter((m) => Date.parse(m.created_at) >= since);
  return {
    items: active,
    lowStock: active.filter((i) => i.level !== "ok").sort((a, b) => a.on_hand_bf / Math.max(1, a.reorder_level_bf) - b.on_hand_bf / Math.max(1, b.reorder_level_bf)),
    totalOnHandBf: money(active.reduce((s, i) => s + i.on_hand_bf, 0)),
    received30: money(recent.filter((m) => m.kind === "receive").reduce((s, m) => s + m.board_feet, 0)),
    used30: money(recent.filter((m) => m.kind === "use").reduce((s, m) => s + m.board_feet, 0)),
  };
}

const num = (label: string) => z.coerce.number({ error: `${label} must be a number.` }).finite();
const itemSchema = z.object({
  wood_name: z.string().trim().min(2, { error: "Enter the wood name." }).max(60),
  wood_type: z.enum(WOOD_TYPES).default("Other"),
  size_note: z.string().trim().max(60).optional().default(""),
  reorder_level_bf: num("Reorder level").min(0, { error: "The reorder level cannot be negative." }).max(1_000_000),
});

const movementSchema = z.object({
  item_id: z.uuid({ error: "Choose the lumber." }),
  kind: z.enum(LUMBER_MOVEMENT_KINDS),
  /** either board feet directly, or pieces of a size */
  board_feet: z.union([z.literal(""), num("Board feet")]).optional().default(""),
  pieces: z.union([z.literal(""), num("Pieces").int().positive()]).optional().default(""),
  thickness_in: z.union([z.literal(""), num("Thickness").positive()]).optional().default(""),
  width_in: z.union([z.literal(""), num("Width").positive()]).optional().default(""),
  length_ft: z.union([z.literal(""), num("Length").positive()]).optional().default(""),
  order_code: z.string().trim().max(20).optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
  client_transaction_id: z.uuid(),
});

/** Owner: add a timber the shop stocks. Opening stock is then recorded as a receive. */
export async function addLumberItem(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner"], "add lumber items");
  const p = itemSchema.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", p.error);
  return store.insertLumberItem({ ...p.data, size_note: p.data.size_note || null });
}

/** Owner: change the reorder level (the low-stock alert threshold). */
export async function setReorderLevel(store: DataStore, actor: Actor, itemId: string, level: number) {
  ensureRole(actor, ["owner"], "change reorder levels");
  if (!Number.isFinite(level) || level < 0) throw new DomainError("VALIDATION", "The reorder level cannot be negative.");
  return store.updateLumberItem(itemId, { reorder_level_bf: money(level) });
}

/**
 * Owner / staff: record lumber received, used (optionally for an order) or a
 * counted adjustment. Board feet come from the entry or from pieces × size.
 * The store applies it atomically and refuses to take stock below zero.
 */
export async function recordLumberMovement(store: DataStore, actor: Actor, raw: unknown) {
  ensureRole(actor, ["owner", "staff"], "record lumber");
  const p = movementSchema.safeParse(raw);
  if (!p.success) throw new DomainError("VALIDATION", "Please fix the highlighted fields.", p.error);
  const v = p.data;
  let bf: number;
  if (v.board_feet !== "") bf = money(v.board_feet);
  else if (v.pieces !== "" && v.thickness_in !== "" && v.width_in !== "" && v.length_ft !== "") bf = boardFeet(v.thickness_in, v.width_in, v.length_ft, v.pieces);
  else throw new DomainError("VALIDATION", "Enter the board feet, or the pieces and their size.");
  if (v.kind === "adjust" && !v.note) throw new DomainError("VALIDATION", "Give a reason for the stock adjustment.");
  if (v.kind !== "adjust" && !(bf > 0)) throw new DomainError("VALIDATION", "Enter a positive amount.");
  let orderId: string | null = null;
  if (v.order_code) {
    const o = await store.getOrderByCode(v.order_code);
    if (!o) throw new DomainError("VALIDATION", `Order ${v.order_code.toUpperCase()} was not found.`);
    orderId = o.id;
  }
  return store.insertLumberMovement({
    item_id: v.item_id, kind: v.kind, board_feet: bf, order_id: orderId, note: v.note || null,
    recorded_by: actor.id, client_transaction_id: v.client_transaction_id,
  });
}
