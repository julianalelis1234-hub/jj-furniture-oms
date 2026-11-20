import { AppShell } from "@/components/app-shell";
import { isDemoMode } from "@/lib/config";
import { DEMO_CUSTOMER_SAMPLES } from "@/lib/data/seed";
import { LookupForm } from "./lookup-form";

export const metadata = { title: "Track your order" };

export default async function TrackPage({ searchParams }: PageProps<"/track">) {
  const code = (await searchParams).code;
  return (
    <AppShell portal="customer" actor={null}>
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold sm:text-3xl">Track your furniture</h1>
        <p className="mt-1 mb-4 text-muted-foreground">
          Enter the Order ID printed on your JJ Furniture slip. Add your 4-digit PIN to see prices, confirm specifications or request a touch-up.
        </p>
        <LookupForm initialCode={typeof code === "string" ? code : ""} samples={isDemoMode() ? DEMO_CUSTOMER_SAMPLES : []} />
      </div>
    </AppShell>
  );
}
