/** Runtime configuration. Only NEXT_PUBLIC_* values may reach the browser. */
export const APP_MODE: "demo" | "production" =
  process.env.NEXT_PUBLIC_APP_MODE === "production" ? "production" : "demo";

export const isDemoMode = () => APP_MODE === "demo";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
