import path from "node:path";
import { Hono, type Context } from "hono";
import { DATA_DIR, DEMO, features, publicBase } from "../config.ts";
import { markPaid } from "../crew/closer.ts";
import { cancelQueued } from "../crew/pitcher.ts";
import { abs, postalAddress, priceLabel } from "../crew/shared.ts";
import { VARIANT_IDS } from "../design-ids.ts";
import { addApproval, getLeadByToken, getSettings, kvGet, kvSet, pendingApprovalFor, suppress, updateLead } from "../db.ts";
import { leadChanged, log } from "../events.ts";
import { getNiche } from "../niches.ts";
import { notifyOwner } from "../providers/notify.ts";
import { createCheckout, stripeTestMode } from "../providers/stripe.ts";
import { renderProposal } from "../site/proposal.ts";
import type { Lead } from "../types.ts";
import { errorMessage, money } from "../util.ts";
import { isAuthed } from "./auth.ts";
import { safeJoin, sendFile } from "./files.ts";

// What prospects see: the proposal page, the mockups, the video, the claim
// button (Stripe Checkout), one-click unsubscribe, and live sites after payment.

export const pub = new Hono();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f7f6f2;color:#16181d;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:460px;background:#fff;border:1px solid #e7e4dc;border-radius:20px;padding:32px;box-shadow:0 10px 40px rgba(0,0,0,.06)}h1{font-size:24px;line-height:1.25;margin:0 0 12px}p{margin:0 0 14px;color:#454a55}
.btn{display:inline-block;border:0;border-radius:999px;padding:14px 22px;font:600 16px/1 inherit;background:#16181d;color:#fff;text-decoration:none;cursor:pointer}.btn.green{background:#17803d}.muted{font-size:13px;color:#7a7f8a}</style></head>
<body><main>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function leadFor(c: Context): Lead | undefined {
  const lead = getLeadByToken(c.req.param("token") ?? "");
  return lead && lead.status !== "dnc" ? lead : undefined;
}

const gone = () => page("Not available", `<h1>This page isn't available</h1><p>The link may have expired or been removed.</p>`, 404);

pub.get("/p/:token", (c) => {
  const lead = getLeadByToken(c.req.param("token"));
  if (!lead) return gone();
  const s = getSettings();
  const t = lead.proposalToken!;
  if (!isAuthed(c) || !getSettings().owner.email) trackView(lead);
  const html = renderProposal({
    token: t,
    business: { name: lead.name, city: lead.city, nicheLabel: getNiche(lead.niche).label },
    agency: { name: s.owner.agencyName, ownerName: s.owner.name || s.owner.agencyName, email: s.owner.email || "hello@example.com", phone: s.owner.phone, postalAddress: postalAddress(s), bookingUrl: s.owner.bookingUrl },
    variants: (lead.variants ?? []).map((v) => ({ id: v.id, label: v.label, url: `/p/${t}/site/${v.id}/`, thumbUrl: v.screenshot ? `/p/${t}/thumb/${v.id}.jpg` : undefined })),
    video: lead.video ? { url: `/p/${t}/video.mp4`, poster: `/p/${t}/poster.jpg` } : undefined,
    noticed: (lead.diagnosis?.evidence?.length ? lead.diagnosis.evidence : (lead.audit?.findings ?? [])).slice(0, 4),
    priceLabel: priceLabel(lead.dealValueCents ?? lead.priceCents, s),
    hostingLabel: s.offer.hostingMonthlyCents ? `then ${money(s.offer.hostingMonthlyCents, s.offer.currency)}/month for hosting and updates` : undefined,
    deliveryDays: s.offer.deliveryDays,
    guarantee: s.offer.guarantee,
    claimUrl: `/p/${t}/claim`,
    unsubscribeUrl: `/u/${t}`,
    state: lead.status === "won" || c.req.query("paid") ? "paid" : lead.status === "dnc" ? "closed" : "open",
  });
  return c.html(html, 200, { "cache-control": "no-store", "x-robots-tag": "noindex" });
});

function trackView(lead: Lead) {
  const key = `viewed:${lead.id}`;
  const last = kvGet<number>(key) ?? 0;
  if (Date.now() - last < 60 * 60_000) return;
  kvSet(key, Date.now());
  log("closer", "Opened the proposal.", { lead, level: "success" });
  void notifyOwner({ title: `${lead.name} is looking at your proposal`, body: `${lead.name} (${lead.city}) just opened it. Good moment for a call${lead.phone ? `: ${lead.phone}` : ""}.`, priority: "default", path: `#/lead/${lead.id}`, tags: ["eyes"], dedupeKey: key });
}

pub.get("/p/:token/site/:variant", (c) => c.redirect(`/p/${c.req.param("token")}/site/${c.req.param("variant")}/`, 301));
pub.get("/p/:token/site/:variant/", (c) => {
  const lead = leadFor(c);
  const v = lead?.variants?.find((x) => x.id === c.req.param("variant"));
  if (!lead || !v || !(VARIANT_IDS as readonly string[]).includes(v.id)) return gone();
  return sendFile(c, abs(v.path), { cache: "no-cache", headers: { "x-robots-tag": "noindex" } });
});

pub.get("/p/:token/thumb/:file", (c) => {
  const lead = leadFor(c);
  const id = c.req.param("file").replace(/\.jpg$/, "");
  const v = lead?.variants?.find((x) => x.id === id);
  return v?.screenshot ? sendFile(c, abs(v.screenshot)) : c.text("Not found", 404);
});

pub.get("/p/:token/:file{hero\\.(jpg|png|webp)}", (c) => {
  const lead = leadFor(c);
  return lead?.heroImage ? sendFile(c, abs(lead.heroImage), { cache: "public, max-age=86400" }) : c.text("Not found", 404);
});

pub.get("/p/:token/video.mp4", (c) => {
  const lead = leadFor(c);
  return lead?.video ? sendFile(c, abs(lead.video.path)) : c.text("Not found", 404);
});

pub.get("/p/:token/poster.jpg", (c) => {
  const lead = leadFor(c);
  return lead?.video ? sendFile(c, abs(lead.video.poster)) : c.text("Not found", 404);
});

// ── Claim (payment) ──────────────────────────────────────────────────────

pub.get("/p/:token/claim", async (c) => {
  const lead = leadFor(c);
  if (!lead) return gone();
  const t = lead.proposalToken!;
  if (lead.status === "won") return c.redirect(`/p/${t}?paid=1`);
  const s = getSettings();
  const variant = (VARIANT_IDS as readonly string[]).includes(c.req.query("variant") ?? "") ? c.req.query("variant") : undefined;
  const amount = lead.dealValueCents ?? lead.priceCents;
  log("closer", `Clicked "Claim this website"${variant ? ` (${variant} design)` : ""}.`, { lead, level: "success" });
  if (lead.status !== "negotiating") leadChanged(updateLead(lead.id, (l) => (l.status = "negotiating"))!);
  cancelQueued(lead.id, "They clicked Claim");

  if (amount > s.escalation.dealOverCents && !kvGet(`deal_ok:${lead.id}`)) {
    if (!pendingApprovalFor(lead.id, "deal")) addApproval({ kind: "deal", leadId: lead.id, leadName: lead.name, title: `${lead.name} wants to claim a ${money(amount, s.offer.currency)} project`, detail: "Over your approval limit, so checkout waits for you.", amountCents: amount });
    void notifyOwner({ title: `${money(amount, s.offer.currency)} claim needs you`, body: `${lead.name} clicked Claim on a ${money(amount, s.offer.currency)} quote.`, priority: "urgent", path: "#/approvals", call: { reason: `${lead.name} wants to pay ${money(amount, s.offer.currency)}, which is over your limit.` }, dedupeKey: `claim:${lead.id}` });
    return page("Almost there", `<h1>Thanks, ${esc(lead.name)}!</h1><p>Because this is a custom project, ${esc(s.owner.name || s.owner.agencyName)} will confirm your quote by email today. No payment is needed yet.</p><p class="muted">${esc(s.owner.agencyName)}</p>`);
  }

  if (features.stripe) {
    try {
      const session = await createCheckout({
        leadId: lead.id,
        token: t,
        businessName: lead.name,
        amountCents: amount,
        currency: s.offer.currency,
        hostingMonthlyCents: s.offer.hostingMonthlyCents,
        email: lead.email,
        variant,
        successUrl: `${publicBase()}/p/${t}?paid=1`,
        cancelUrl: `${publicBase()}/p/${t}`,
      });
      if (lead.chosenVariant !== variant && variant) updateLead(lead.id, (l) => (l.chosenVariant = variant as Lead["chosenVariant"]));
      return c.redirect(session.url, 303);
    } catch (err) {
      log("closer", `Checkout failed: ${errorMessage(err)}`, { lead, level: "error" });
    }
  }
  if (DEMO) {
    return page(
      "Demo checkout",
      `<h1>Demo checkout</h1><p>In demo mode there's no real payment. Press the button to simulate ${esc(lead.name)} paying ${esc(money(amount, s.offer.currency))} and watch the Closer launch the site.</p>
      <form method="post" action="/p/${esc(t)}/claim/demo${variant ? `?variant=${esc(variant)}` : ""}"><button class="btn green">Simulate payment</button></form>`,
    );
  }
  void notifyOwner({ title: `${lead.name} wants to buy`, body: `${lead.name} clicked Claim. Stripe isn't connected, so send them an invoice.`, priority: "high", path: `#/lead/${lead.id}`, dedupeKey: `claim:${lead.id}` });
  return page("Thank you", `<h1>Thank you!</h1><p>${esc(s.owner.name || s.owner.agencyName)} will email you an invoice today. Your site goes live within ${s.offer.deliveryDays} days of payment.</p><p class="muted">Questions? <a href="mailto:${esc(s.owner.email)}">${esc(s.owner.email)}</a></p>`);
});

pub.post("/p/:token/claim/demo", async (c) => {
  const lead = leadFor(c);
  if (!lead || !DEMO) return gone();
  const s = getSettings();
  const variant = c.req.query("variant");
  await markPaid(lead, { amountCents: lead.dealValueCents ?? lead.priceCents, currency: s.offer.currency, externalId: `demo_${lead.id}`, provider: "demo", variant });
  return c.redirect(`/p/${lead.proposalToken}?paid=1`, 303);
});

// ── Unsubscribe ──────────────────────────────────────────────────────────

pub.get("/u/:token", (c) => {
  const lead = getLeadByToken(c.req.param("token"));
  if (!lead) return gone();
  if (lead.status === "dnc") return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>You won't hear from us again.</p>`);
  return page("Unsubscribe", `<h1>Unsubscribe ${esc(lead.name)}?</h1><p>We'll stop all messages right away and won't contact you again.</p><form method="post"><button class="btn">Unsubscribe</button></form>`);
});

pub.post("/u/:token", (c) => {
  const lead = getLeadByToken(c.req.param("token"));
  if (!lead) return gone();
  if (lead.email) suppress(lead.email, "email", "unsubscribed");
  if (lead.phone) suppress(lead.phone, "phone", "unsubscribed");
  suppress(lead.sourceId, "place", "unsubscribed");
  cancelQueued(lead.id, "Unsubscribed");
  if (lead.status !== "won") {
    const u = updateLead(lead.id, (l) => (l.status = "dnc"));
    if (u) leadChanged(u);
  }
  log("closer", "Unsubscribed. They're on the do-not-contact list.", { lead });
  return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>Done. You won't hear from us again.</p>`);
});

// ── Live client sites ────────────────────────────────────────────────────

pub.get("/live/:slug", (c) => c.redirect(`/live/${c.req.param("slug")}/`, 301));
pub.get("/live/:slug/*", (c) => {
  const leadId = kvGet<string>(`live:${c.req.param("slug")}`);
  if (!leadId) return gone();
  const rest = c.req.path.replace(/^\/live\/[^/]+\/?/, "") || "index.html";
  const file = safeJoin(path.join(DATA_DIR, "leads", leadId, "live"), rest);
  return file ? sendFile(c, file, { cache: "public, max-age=300" }) : gone();
});

export const stripeMode = () => (features.stripe ? (stripeTestMode() ? "test" : "live") : "off");
