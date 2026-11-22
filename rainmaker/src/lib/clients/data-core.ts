// Storage-agnostic core for per-client documents: compare-and-set updates
// with retries, an empty document, and size limits. No Node or Next imports,
// so it's unit tested with an in-memory backend.

import type { ClientData } from "../types.ts";

export interface DocBackend {
  kind: "file" | "postgres";
  /** The latest document and its version; an empty one (version 0) when missing. */
  load(id: string): Promise<{ doc: ClientData; version: number }>;
  /** Save if nobody saved since `version`. Returns the new version, or null on a conflict. */
  save(id: string, doc: ClientData, version: number): Promise<number | null>;
  remove(id: string): Promise<void>;
}

export const LIMITS = {
  contacts: 20_000,
  messages: 5_000,
  calls: 3_000,
  reviews: 300,
  days: 400,
} as const;

export function emptyClientData(clientId: string): ClientData {
  return { version: 1, clientId, contacts: [], messages: [], calls: [], sequences: [], reviews: [], daily: {} };
}

/** Fill in anything an older or hand-edited document lacks. */
export function normalizeClientData(raw: Partial<ClientData> | undefined, clientId: string): ClientData {
  const base = emptyClientData(clientId);
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    clientId,
    contacts: (raw.contacts ?? []).map((c) => ({ ...c, enrollments: c.enrollments ?? [], consent: c.consent ?? { email: false, sms: false, basis: "none" } })),
    messages: raw.messages ?? [],
    calls: raw.calls ?? [],
    sequences: raw.sequences ?? [],
    reviews: raw.reviews ?? [],
    daily: raw.daily ?? {},
    version: 1,
  };
}

/** Keep the document to a size that's cheap to load and save. Newest first lists keep their head. */
export function trimClientData(d: ClientData): void {
  if (d.messages.length > LIMITS.messages) d.messages = d.messages.slice(-LIMITS.messages);
  if (d.calls.length > LIMITS.calls) d.calls = d.calls.slice(0, LIMITS.calls);
  if (d.reviews.length > LIMITS.reviews) d.reviews = d.reviews.slice(0, LIMITS.reviews);
  const days = Object.keys(d.daily).sort();
  for (const day of days.slice(0, Math.max(0, days.length - LIMITS.days))) delete d.daily[day];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-modify-write with optimistic concurrency. `fn` may run more than once
 * (on a conflict it re-runs against fresh data), so it must only change `doc`:
 * send messages after the update, never inside it.
 */
export async function casClientData<T>(backend: DocBackend, id: string, fn: (doc: ClientData) => T | Promise<T>, attempts = 6): Promise<{ result: T; doc: ClientData }> {
  for (let i = 0; i < attempts; i++) {
    const { doc, version } = await backend.load(id);
    const result = await fn(doc);
    trimClientData(doc);
    const next = await backend.save(id, doc, version);
    if (next !== null) return { result, doc };
    await sleep(20 * (i + 1) + Math.floor(Math.random() * 40));
  }
  throw new Error("Too many changes to this client at the same moment. Try again.");
}
