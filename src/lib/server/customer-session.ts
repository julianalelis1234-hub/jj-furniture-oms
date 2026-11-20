import "server-only";
import { cookies } from "next/headers";
import { verifyToken } from "./token";

export const CUSTOMER_COOKIE = "jj_customer";

/** Order id from the signed, http-only customer cookie (scoped to exactly one order). */
export async function getVerifiedCustomerOrderId(): Promise<string | null> {
  return verifyToken<{ oid: string }>((await cookies()).get(CUSTOMER_COOKIE)?.value)?.oid ?? null;
}
