import { CURRENCIES, OFFERS } from "@/lib/catalog";
import { elevenEnabled } from "@/lib/config";
import { readBody, route } from "@/lib/http";
import { readDb, update } from "@/lib/store";
import type { PriceOverride, StoreSettings } from "@/lib/types";

// The owner's store settings and price overrides. Lives outside /api/store,
// so it stays behind the sign-in.

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : undefined);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export const GET = route(async () => {
  const { store } = await readDb();
  return Response.json({ store: { currency: store.currency, prices: store.prices, waiveSetupOnAnnual: store.waiveSetupOnAnnual, enabled: store.enabled }, elevenlabs: elevenEnabled() });
});

export const PUT = route(async (req: Request) => {
  const b = await readBody<Partial<StoreSettings> & { prices?: Record<string, PriceOverride> }>(req);
  const store = await update((db) => {
    const s = db.store;
    if (typeof b.enabled === "boolean") s.enabled = b.enabled;
    if (typeof b.annual === "boolean") s.annual = b.annual;
    if (typeof b.waiveSetupOnAnnual === "boolean") s.waiveSetupOnAnnual = b.waiveSetupOnAnnual;
    if (typeof b.showEngine === "boolean") s.showEngine = b.showEngine;
    if (b.currency && CURRENCIES.some((c) => c.id === b.currency)) s.currency = b.currency;
    const headline = text(b.headline, 160);
    if (headline) s.headline = headline;
    const sub = text(b.subheadline, 400);
    if (sub) s.subheadline = sub;
    const assistant = text(b.assistantName, 30);
    if (assistant) s.assistantName = assistant;
    const overage = num(b.overagePerMinute, 0, 10);
    if (overage !== undefined) s.overagePerMinute = overage;
    if (b.prices && typeof b.prices === "object") {
      const next: Record<string, PriceOverride> = {};
      for (const o of OFFERS) {
        const p = b.prices[o.id];
        if (!p) continue;
        const entry: PriceOverride = {};
        const monthly = num(p.monthly, 1, 100_000);
        const setup = num(p.setup, 0, 100_000);
        if (monthly !== undefined && monthly !== o.monthly) entry.monthly = monthly;
        if (setup !== undefined && setup !== o.setup) entry.setup = setup;
        if (p.hidden === true) entry.hidden = true;
        if (Object.keys(entry).length) next[o.id] = entry;
      }
      s.prices = next;
    }
    return structuredClone(s);
  });
  return Response.json({ store });
});
