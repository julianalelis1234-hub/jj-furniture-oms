import { Check, Hammer, Minus, ShieldCheck, Truck, Users } from "lucide-react";
import { CardSection, chip, DarkCard, KpiCard, KpiRow, PersonCard } from "@/components/dashboard";
import { cn } from "@/lib/utils";
import { OwnerHeading, OwnerShell } from "@/components/owner/owner-shell";
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
      <KpiRow>
        <KpiCard label="Active accounts" value={accounts.filter((p) => p.is_active).length} icon={<ShieldCheck />} sub={`${accounts.filter((p) => !p.is_active).length} disabled`} tone="good" />
        <KpiCard label="Office" value={accounts.filter((p) => p.role === "owner" || p.role === "staff").length} icon={<Users />} sub="owner and staff" />
        <KpiCard label="Craftsmen" value={accounts.filter((p) => p.role === "craftsman").length} icon={<Hammer />} sub="workshop accounts" />
        <KpiCard label="Riders" value={accounts.filter((p) => p.role === "driver").length} icon={<Truck />} sub="delivery accounts" />
      </KpiRow>

      <CardSection id="matrix" title="Permissions" chip="Checked on the server and in the database">
        <div className="-mx-3.5 overflow-x-auto px-3.5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[36rem] text-xs sm:text-sm" data-testid="access-matrix">
            <thead>
              <tr className="border-b-2 border-foreground/80 text-left">
                <th scope="col" className="py-2 pr-4 font-semibold">Can…</th>
                {ROLES.map((r) => <th key={r} scope="col" className="px-2 py-2 text-center font-semibold">{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map(([what, who]) => (
                <tr key={what} className="border-b border-border">
                  <th scope="row" className="py-2 pr-4 text-left font-normal sm:py-2.5">{what}</th>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2 text-center sm:py-2.5">
                      {who.includes(r) ? <Check className="mx-auto size-4 text-success" aria-label="yes" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="no" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardSection>

      <div className="grid gap-3 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <CardSection id="accounts" title="Shop accounts" className="mb-0 sm:mb-0">
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3" data-testid="accounts">
            {accounts.map((p) => (
              <PersonCard key={p.id} name={p.full_name} line={label[p.role]}
                chips={<span className={cn(chip, p.is_active ? "bg-success-soft text-success" : "bg-destructive/10 text-destructive")}>{p.is_active ? "Active" : "Disabled"}</span>} />
            ))}
          </ul>
          {isDemoMode() && (
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 sm:text-sm" data-testid="demo-account-list">
              {demoAccounts().map((a) => (
                <div key={a.key} className="flex flex-wrap justify-between gap-x-3 border-b border-border py-2">
                  <dt className="font-semibold">{a.label}</dt><dd className="text-muted-foreground">{a.email}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardSection>
        <DarkCard id="how-access" title="How accounts work" chip="">
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">
            {isDemoMode() ? "Demo Mode: these people are signed in through the fixed demo accounts listed beside this card." : "Accounts are created and disabled in Supabase Auth; a disabled account loses access at once."}
          </p>
          <p className="rounded-xl bg-white/[0.07] p-3 text-sm leading-snug">Customers get their own account only after the shop confirms their first order, through a set-up link sent to their email.</p>
        </DarkCard>
      </div>
    </OwnerShell>
  );
}
