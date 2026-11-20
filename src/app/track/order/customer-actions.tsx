"use client";

import { CheckCircle2, LogOut, Wrench } from "lucide-react";
import { customerConfirmAction, customerRepairAction, customerSignOut } from "@/app/actions";
import { ActionDialog } from "@/components/action-dialog";
import { Field, TextArea } from "@/components/form";
import { Button } from "@/components/ui/button";

export function CustomerActions({ specsConfirmed, canConfirm, canRequestRepair }: { specsConfirmed: boolean; canConfirm: boolean; canRequestRepair: boolean }) {
  if (specsConfirmed && !canRequestRepair) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {!specsConfirmed && canConfirm && (
        <ActionDialog trigger="Confirm Specifications" icon={<CheckCircle2 aria-hidden />} size="xl" variant="success"
          title="Confirm your order specifications?"
          description="By confirming, you agree the dimensions, wood, color, quantity and price shown on this page are correct. We start building after your 30% down payment."
          submitLabel="Yes, these are correct" submitVariant="success" action={() => customerConfirmAction()}>
          <p className="text-sm">If anything is wrong, call or message JJ Furniture instead. Do not confirm.</p>
        </ActionDialog>
      )}
      {canRequestRepair && (
        <ActionDialog trigger="Request Touch-Up / Repair" icon={<Wrench aria-hidden />} size="xl" variant="outline"
          title="Request a touch-up or repair" description="Tell us what you noticed. The shop will call you to schedule the painter."
          submitLabel="Send request" action={(fd) => customerRepairAction(String(fd.get("description") ?? ""))}>
          <Field label="What needs fixing?" htmlFor="description" required>
            <TextArea id="description" name="description" required minLength={5} maxLength={1000} placeholder="e.g. Small scratch on the left door, about 5cm." />
          </Field>
        </ActionDialog>
      )}
    </div>
  );
}

export function CustomerSignOut() {
  return (
    <form action={customerSignOut}>
      <Button variant="ghost" size="touch" type="submit"><LogOut aria-hidden /> <span className="hidden sm:inline">Close order</span></Button>
    </form>
  );
}
