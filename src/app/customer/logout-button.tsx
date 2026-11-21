import { LogOut } from "lucide-react";
import { customerLogoutAction } from "@/app/customer/actions";
import { Button } from "@/components/ui/button";

export function CustomerLogoutButton() {
  return (
    <form action={customerLogoutAction}>
      <Button variant="ghost" size="touch" type="submit" data-testid="customer-logout"><LogOut aria-hidden /> <span className="hidden sm:inline">Log out</span></Button>
    </form>
  );
}
