import { LogOut } from "lucide-react";
import { customerLogoutAction } from "@/app/customer/actions";
import { Button } from "@/components/ui/button";

/** Customer log-out. `compact`: the icon-only version inside the sidebar's account card. */
export function CustomerLogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action={customerLogoutAction}>
      {compact
        ? <Button variant="ghost" size="icon-touch" type="submit" aria-label="Log out" title="Log out" data-testid="customer-logout-sidebar"><LogOut aria-hidden /></Button>
        : <Button variant="ghost" size="touch" type="submit" data-testid="customer-logout"><LogOut aria-hidden /> <span className="hidden sm:inline">Log out</span></Button>}
    </form>
  );
}
