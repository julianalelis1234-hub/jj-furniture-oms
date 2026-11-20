import "server-only";
import { MemoryStore } from "@/lib/data/memory-store";
import { buildSeedTables } from "@/lib/data/seed";

const g = globalThis as unknown as { __jjMemory?: Promise<MemoryStore> };

/** Process-wide demo database (survives hot reloads; reset with resetMemoryStore). */
export function getMemoryStore(): Promise<MemoryStore> {
  g.__jjMemory ??= buildSeedTables().then((t) => new MemoryStore(t));
  return g.__jjMemory;
}

export async function resetMemoryStore(): Promise<void> {
  const store = await getMemoryStore();
  store.t = await buildSeedTables();
}
