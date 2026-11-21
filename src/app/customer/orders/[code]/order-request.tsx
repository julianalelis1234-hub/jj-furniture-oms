"use client";

import { Hammer, Wrench } from "lucide-react";
import { useState } from "react";
import { customerOrderRequestAction } from "@/app/customer/actions";
import { ActionDialog } from "@/components/action-dialog";
import { Field, NativeSelect, TextArea } from "@/components/form";

/** After confirmation the specification is locked: changes and repairs go to the shop for approval. */
export function PostConfirmationRequest({ orderCode, status }: { orderCode: string; status: string }) {
  const [kind, setKind] = useState<"change" | "repair">(status === "Delivered" || status === "Out for Delivery" ? "repair" : "change");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionDialog
        trigger="Request Post-Confirmation Change / Repair"
        icon={<Wrench aria-hidden />}
        size="xl"
        triggerClassName="h-auto min-h-12 w-full py-2 whitespace-normal sm:w-auto"
        variant="outline"
        title="Request a change or repair"
        description="Your confirmed specification is locked for the workshop. The shop will review your request and contact you before anything changes."
        submitLabel="Send request"
        action={(fd) => customerOrderRequestAction(orderCode, kind, fd)}
      >
        <Field label="Request type" htmlFor="kind">
          <NativeSelect id="kind" value={kind} onChange={(e) => setKind(e.target.value as "change" | "repair")}
            options={[{ value: "change", label: "Change to the confirmed specification" }, { value: "repair", label: "Touch-up / repair" }]} />
        </Field>
        <Field label="What do you need?" htmlFor="description" required>
          <TextArea id="description" name="description" required minLength={5} maxLength={1000}
            placeholder={kind === "change" ? "e.g. Could the table be 10cm longer?" : "e.g. Small scratch on the left door, about 5cm."} />
        </Field>
      </ActionDialog>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Hammer className="size-3.5" aria-hidden /> Changes after confirmation need the shop&apos;s approval.</span>
    </div>
  );
}
