import "server-only";
import { hasSupabase } from "@/lib/config";
import type { MemoryStore } from "@/lib/data/memory-store";
import { DomainError } from "@/lib/domain/errors";
import type { ProofStore } from "@/lib/services/payments";
import { getMemoryStore } from "./memory";
import { createAdminClient } from "./supabase";

const BUCKET = "payment-proofs";
const ROOM_BUCKET = "room-photos";

/**
 * Proof-of-payment files. Production: the private `payment-proofs` bucket
 * (migration 009), written and read with the service role on the server only,
 * so browsers never get a storage URL. Demo without Supabase: kept in memory.
 */
export function getProofStore(): ProofStore {
  return privateFileStore(BUCKET, "");
}

/** Customers' room photos (migration 011): private bucket, server-side only, like the receipts. */
export function getRoomPhotoStore(): ProofStore {
  return privateFileStore(ROOM_BUCKET, "room:");
}

function privateFileStore(bucket: string, memoryPrefix: string): ProofStore {
  if (hasSupabase()) {
    const admin = createAdminClient();
    if (!admin) throw new DomainError("BACKEND", "File uploads require SUPABASE_SERVICE_ROLE_KEY on the server.");
    return {
      async put(path, bytes, contentType) {
        const { error } = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
        if (error) throw new DomainError("BACKEND", "The file could not be uploaded. Please try again.");
      },
      async get(path) {
        const { data, error } = await admin.storage.from(bucket).download(path);
        if (error || !data) return null;
        return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
      },
    };
  }
  const tables = async () => ((await getMemoryStore()) as MemoryStore).t;
  return {
    async put(path, bytes, contentType) {
      (await tables()).payment_proofs.push({ path: memoryPrefix + path, bytes, content_type: contentType });
    },
    async get(path) {
      const f = (await tables()).payment_proofs.find((x) => x.path === memoryPrefix + path);
      return f ? { bytes: f.bytes, contentType: f.content_type } : null;
    },
  };
}
