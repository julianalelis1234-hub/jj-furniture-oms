"use client";

import { ArrowDownToLine, ArrowUpFromLine, Plus, Scale } from "lucide-react";
import { useState } from "react";
import { addLumberItemAction, recordLumberAction, setReorderLevelAction } from "@/app/actions";
import { ActionDialog } from "@/components/action-dialog";
import { Field, NativeSelect, TextInput, useServerAction } from "@/components/form";
import { Button } from "@/components/ui/button";
import { WOOD_TYPES, type LumberItem, type LumberMovementKind } from "@/lib/domain/types";
import { newUuid } from "@/lib/uuid";

const KIND_COPY: Record<LumberMovementKind, { trigger: string; title: string; submit: string; icon: typeof Plus }> = {
  receive: { trigger: "Receive", title: "Receive lumber", submit: "Add to stock", icon: ArrowDownToLine },
  use: { trigger: "Use", title: "Use lumber", submit: "Take from stock", icon: ArrowUpFromLine },
  adjust: { trigger: "Adjust", title: "Adjust after a stock count", submit: "Save adjustment", icon: Scale },
};

const bfOf = (t: string, w: string, l: string, n: string) => {
  const v = [t, w, l, n].map(Number);
  return v.every((x) => x > 0) ? Math.round(((v[0] * v[1] * v[2] * v[3]) / 12) * 100) / 100 : null;
};

/** Receive / use / adjust one timber. Board feet are typed, or worked out from pieces × thickness × width × length. */
export function RecordLumberDialog({ item, kind }: { item: Pick<LumberItem, "id" | "wood_name" | "size_note" | "on_hand_bf">; kind: LumberMovementKind }) {
  const [txn, setTxn] = useState(() => newUuid()); // one key per filled-in dialog: a double tap never records twice
  const [mode, setMode] = useState<"bf" | "pieces">(kind === "adjust" ? "bf" : "pieces");
  const [dims, setDims] = useState({ pieces: "", thickness_in: "", width_in: "", length_ft: "" });
  const c = KIND_COPY[kind];
  const Icon = c.icon;
  const calc = bfOf(dims.thickness_in, dims.width_in, dims.length_ft, dims.pieces);
  return (
    <ActionDialog trigger={c.trigger} icon={<Icon aria-hidden />} variant={kind === "receive" ? "default" : "outline"} size="sm"
      triggerClassName="rounded-full" title={`${c.title} · ${item.wood_name}${item.size_note ? ` ${item.size_note}` : ""}`}
      description={`On hand: ${item.on_hand_bf.toLocaleString("en-PH")} board feet.${kind === "adjust" ? " Enter the difference from your count: negative to remove, positive to add." : ""}`}
      submitLabel={c.submit} submitVariant={kind === "use" ? "warning" : "default"}
      action={(fd) => { fd.set("item_id", item.id); fd.set("kind", kind); fd.set("client_transaction_id", txn); return recordLumberAction(null, fd); }}
      onDone={() => { setTxn(newUuid()); setDims({ pieces: "", thickness_in: "", width_in: "", length_ft: "" }); }}>
      {(errors) => (
        <>
          {kind !== "adjust" && (
            <div className="flex gap-2" role="radiogroup" aria-label="How to enter the amount">
              {(["pieces", "bf"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={mode === m ? "h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground" : "h-10 rounded-full border px-4 text-sm font-semibold"}>
                  {m === "pieces" ? "Pieces × size" : "Board feet"}
                </button>
              ))}
            </div>
          )}
          {mode === "pieces" ? (
            <div className="grid grid-cols-2 gap-3">
              {([["pieces", "Pieces", "1"], ["thickness_in", "Thickness (in)", "0.25"], ["width_in", "Width (in)", "0.25"], ["length_ft", "Length (ft)", "0.5"]] as const).map(([k, label, step]) => (
                <Field key={k} label={label} htmlFor={`lm-${k}`} required error={errors[k]}>
                  <TextInput id={`lm-${k}`} name={k} type="number" inputMode="decimal" min={step} step={step} required value={dims[k]}
                    onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value }))} />
                </Field>
              ))}
              <p className="col-span-2 text-sm" aria-live="polite">
                {calc != null ? <>= <b className="tabular-nums">{calc.toLocaleString("en-PH")}</b> board feet</> : "Board feet = thickness × width × length ÷ 12 × pieces"}
              </p>
            </div>
          ) : (
            <Field label="Board feet" htmlFor="lm-bf" required error={errors.board_feet} hint={kind === "adjust" ? "e.g. -6 for six board feet of split boards" : undefined}>
              <TextInput id="lm-bf" name="board_feet" type="number" inputMode="decimal" step="0.01" required />
            </Field>
          )}
          {kind === "use" && (
            <Field label="For order (optional)" htmlFor="lm-order" error={errors.order_code} hint="e.g. JJ-2026-1001">
              <TextInput id="lm-order" name="order_code" autoComplete="off" />
            </Field>
          )}
          <Field label={kind === "adjust" ? "Reason" : "Note (optional)"} htmlFor="lm-note" required={kind === "adjust"} error={errors.note}>
            <TextInput id="lm-note" name="note" maxLength={300} required={kind === "adjust"} placeholder={kind === "receive" ? "Supplier, delivery receipt no." : undefined} />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}

/** Owner: add a timber the shop stocks. */
export function AddLumberItemDialog() {
  return (
    <ActionDialog trigger="Add lumber" icon={<Plus aria-hidden />} title="Add a lumber item" triggerClassName="rounded-full"
      description="Opening stock is recorded afterwards as a receive, so every board foot has a history."
      submitLabel="Add item" action={(fd) => addLumberItemAction(null, fd)}>
      {(errors) => (
        <>
          <Field label="Wood name" htmlFor="li-name" required error={errors.wood_name}><TextInput id="li-name" name="wood_name" required maxLength={60} placeholder="e.g. Narra" /></Field>
          <Field label="Wood group" htmlFor="li-type"><NativeSelect id="li-type" name="wood_type" defaultValue="Other" options={WOOD_TYPES} /></Field>
          <Field label="Size" htmlFor="li-size" hint={'e.g. 2" × 4" × 10 ft'} error={errors.size_note}><TextInput id="li-size" name="size_note" maxLength={60} /></Field>
          <Field label="Reorder level (board feet)" htmlFor="li-reorder" required error={errors.reorder_level_bf}>
            <TextInput id="li-reorder" name="reorder_level_bf" type="number" inputMode="decimal" min="0" step="1" required defaultValue="50" />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}

/** Owner: change the low-stock alert threshold inline. */
export function ReorderLevelEditor({ item }: { item: Pick<LumberItem, "id" | "wood_name" | "reorder_level_bf"> }) {
  const [value, setValue] = useState(String(item.reorder_level_bf));
  const { pending, run } = useServerAction();
  const changed = Number(value) !== item.reorder_level_bf;
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); run(() => setReorderLevelAction(item.id, Number(value))); }}>
      <label htmlFor={`ro-${item.id}`} className="text-xs text-muted-foreground">Reorder at</label>
      <input id={`ro-${item.id}`} type="number" min="0" step="1" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)}
        aria-label={`Reorder level for ${item.wood_name} (board feet)`}
        className="h-9 w-20 rounded-lg border border-input bg-card px-2 text-sm tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/40" />
      {changed && <Button type="submit" size="sm" variant="outline" className="rounded-full" disabled={pending}>Save</Button>}
    </form>
  );
}
