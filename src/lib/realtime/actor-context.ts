import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The acting ROLE for the current server request, used only by the in-memory
 * demo store to fill order_live_events.actor_role the way the SQL trigger
 * does with private.app_role() ('system' for server-side elevated work).
 * Never used for authorization.
 */
const store = new AsyncLocalStorage<string>();
export const withActorRole = <T>(role: string, fn: () => Promise<T>): Promise<T> => store.run(role, fn);
export const currentActorRole = () => store.getStore() ?? "system";
