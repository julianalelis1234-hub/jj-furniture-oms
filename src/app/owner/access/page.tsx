import { Check, Minus } from "lucide-react";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
import { RowList } from "@/components/rows";
import { isDemoMode } from "@/lib/config";
import { demoAccounts } from "@/lib/data/seed";
import { getStore, requireActor } from "@/lib/server/context";
import { loadOwnerContext } from "@/lib/server/office-data";

export const metadata = { title: "Roles & Access" };

const ROLES = ["Owner", "Staff", "Craftsman", "Rider", "Customer"] as const;
/** What each role can do. Enforced on the server and by row-level security in the database, not just hidden in the UI. */
const MATRIX: [string, (typeof ROLES)[number][]][] = [
  ["See every order, customer and payment", ["Owner", "Staff"]],
  ["Encode walk-in orders, confirm orders, issue quotations", ["Owner", "Staff"]],
  ["Verify or reject payments", ["Owner", "Staff"]],
  ["Release a job to the workshop (after the verified 30%)", ["Owner", "Staff"]],
  ["Approve installments, credit and special terms", ["Owner"]],
  ["Pass or fail the quality inspection", ["Owner"]],
  ["Set production priority", ["Owner"]],
  ["Add lumber items and reorder levels", ["Owner"]],
  ["Record lumber received, used or adjusted", ["Owner", "Staff"]],
  ["See assigned jobs (no prices, no phone numbers)", ["Owner", "Staff", "Craftsman"]],
  ["Mark a job ready for inspection, ask a spec question", ["Craftsman"]],
  ["See own deliveries; start, complete or fail a trip", ["Rider"]],
  ["See own orders; accept a quotation; submit a payment", ["Customer"]],
];

/** Roles & Access: the permission matrix and the accounts that hold each role. */
export default async function OwnerAccess() {
  const actor = await requireActor(["owner"]);
  const { data, badges } = await loadOwnerContext(await getStore());
  const label: Record<string, string> = { owner: "Owner", staff: "Staff", craftsman: "Craftsman", driver: "Rider" };
  const accounts = data.profiles.filter((p) => p.role in label).sort((a, b) => Object.keys(label).indexOf(a.role) - Object.keys(label).indexOf(b.role) || a.full_name.localeCompare(b.full_name));
  return (
    <OwnerShell actor={actor} badges={badges}>
      <OwnerHeading title="Roles & Access" description="Who can do what. Every rule is checked on the server and in the database, not only hidden on screen." />
      <section aria-labelledby="matrix-title" className="mb-12">
        <h2 id="matrix-title" className="mb-3 text-2xl">Permissions</h2>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[40rem] text-sm" data-testid="access-matrix">
            <thead>
              <tr className="border-b-2 border-foreground/80 text-left">
                <th scope="col" className="py-2 pr-4 font-semibold">Can…</th>
                {ROLES.map((r) => <th key={r} scope="col" className="px-2 py-2 text-center font-semibold">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([what, who]) => (
                <tr key={what} className="border-b border-border">
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">{what}</th>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2.5 text-center">
                      {who.includes(r) ? <Check className="mx-auto size-4 text-success" aria-label="yes" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="no" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="accounts-title">
        <h2 id="accounts-title" className="mb-1 text-2xl">Shop accounts</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {isDemoMode() ? "Demo Mode: these people are signed in through the fixed demo accounts listed below." : "Accounts are created and disabled in Supabase Auth; a disabled account loses access at once."}
        </p>
        <RowList data-testid="accounts">
          {accounts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-3 sm:px-3">
              <b className="min-w-44">{p.full_name}</b>
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">{label[p.role]}</span>
              <span className={p.is_active ? "ml-auto text-xs font-semibold text-success" : "ml-auto text-xs font-semibold text-destructive"}>{p.is_active ? "Active" : "Disabled"}</span>
            </li>
          ))}
        </RowList>
        {isDemoMode() && (
          <dl className="mt-6 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2" data-testid="demo-account-list">
            {demoAccounts().map((a) => (
              <div key={a.key} className="flex flex-wrap justify-between gap-x-3 border-b border-border py-2">
                <dt className="font-semibold">{a.label}</dt><dd className="text-muted-foreground">{a.email}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </OwnerShell>
  );
}
