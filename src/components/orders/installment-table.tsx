import { formatDate } from "@/lib/domain/dates";
import { formatPeso } from "@/lib/domain/finance";
import type { InstallmentRow } from "@/lib/domain/installments";
import { cn } from "@/lib/utils";

const STATE: Record<InstallmentRow["state"], { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "text-success" },
  partial: { label: "Part paid", cls: "text-warning" },
  due: { label: "Due now", cls: "text-warning" },
  overdue: { label: "Overdue", cls: "text-destructive" },
  upcoming: { label: "Upcoming", cls: "text-muted-foreground" },
};

/** The installment schedule (owner/staff order view and the customer's order page). */
export function InstallmentTable({ rows }: { rows: InstallmentRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="installment-table">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1 pr-2 font-semibold">Payment</th>
            <th className="py-1 pr-2 font-semibold">Due</th>
            <th className="py-1 pr-2 text-right font-semibold">Amount</th>
            <th className="py-1 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-2 font-semibold">{r.label}</td>
              <td className="py-1.5 pr-2 tabular-nums">{r.due ? formatDate(r.due) : "Before production"}</td>
              <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">
                {formatPeso(r.amount)}
                {r.state === "partial" && <span className="block text-xs font-normal text-muted-foreground">paid {formatPeso(r.paid)}</span>}
              </td>
              <td className={cn("py-1.5 text-right text-xs font-bold", STATE[r.state].cls)}>{STATE[r.state].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
