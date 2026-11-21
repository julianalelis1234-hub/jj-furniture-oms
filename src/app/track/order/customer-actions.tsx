"use client";

import { LogOut } from "lucide-react";
import { customerSignOut } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function CustomerSignOut() {
  return (
    <form action={customerSignOut}>
      <Button variant="ghost" size="touch" type="submit"><LogOut aria-hidden /> <span className="hidden sm:inline">Close order</span></Button>
    </form>
  );
}
