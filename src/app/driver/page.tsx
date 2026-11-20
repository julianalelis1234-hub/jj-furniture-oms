import { AppShell } from "@/components/app-shell";
import { getStore, requireActor } from "@/lib/server/context";
import { driverManifest } from "@/lib/services/deliveries";
import { DriverApp } from "./driver-app";

export const metadata = { title: "Deliveries" };

export default async function DriverPage() {
  const actor = await requireActor(["driver"]);
  // Only this driver's assignments (RLS in production; service check everywhere).
  const manifest = await driverManifest(await getStore(), actor);
  return (
    <AppShell portal="driver" actor={actor}>
      <DriverApp driverId={actor.id} initialManifest={manifest} serverTime={new Date().toISOString()} />
    </AppShell>
  );
}
