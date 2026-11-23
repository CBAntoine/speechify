import "server-only";
import { downloadFortinetKev, type KevFile } from "@/review/kev.ts";

// CISA's catalog changes a few times a week, so one copy serves many reviews.
const TTL_MS = 6 * 3_600_000;
const RETRY_MS = 10 * 60_000;
let cached: { at: number; data: KevFile | null } | null = null;

/** The Fortinet entries from CISA's KEV catalog, or null when CISA can't be reached. */
export async function fortinetKev(): Promise<KevFile | null> {
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < (cached.data ? TTL_MS : RETRY_MS)) return cached.data;
  try {
    cached = { at: Date.now(), data: await downloadFortinetKev() };
  } catch (err) {
    console.warn("[engineer] KEV download failed:", (err as Error).message);
    cached = { at: Date.now(), data: cached?.data ?? null };
  }
  return cached.data;
}
