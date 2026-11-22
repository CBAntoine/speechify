import "server-only";
import { getOffer, type Offer, type Price } from "@/lib/catalog";
import { matchNiche } from "@/lib/niches";
import { findDuplicate } from "@/lib/repo";
import { newId, readDb, update } from "@/lib/store";
import type { Activity, Db, Lead, Order, OrderStatus, PaymentProvider } from "@/lib/types";
import { monthlyEquivalent } from "./encode";
import { plannedSteps } from "./steps";

// Orders from the storefront. A checkout creates a pending order (and a lead
// in the pipeline, so abandoned checkouts can be followed up). The payment
// provider's webhook, or the thank-you page, activates it: whichever arrives
// first wins and the other is a no-op.

const now = () => new Date().toISOString();

function pushActivity(db: Db, a: Omit<Activity, "id" | "at">) {
  db.activity.unshift({ id: newId("act"), at: now(), ...a });
}

export interface OrderMatch {
  orderId?: string;
  subscriptionId?: string;
  providerRef?: string;
}

function find(db: Db, m: OrderMatch): Order | undefined {
  return db.orders.find(
    (o) => (m.orderId && o.id === m.orderId) || (m.subscriptionId && o.subscriptionId === m.subscriptionId) || (m.providerRef && o.providerRef === m.providerRef)
  );
}

export async function findOrder(m: OrderMatch): Promise<Order | undefined> {
  return find(await readDb(), m);
}

export async function listOrders(): Promise<Order[]> {
  return (await readDb()).orders;
}

export interface Buyer {
  email?: string;
  name?: string;
  business?: string;
  phone?: string;
  website?: string;
  notes?: string;
}

/** Find the buyer's lead, or add one: every checkout is a hot inbound lead. */
function upsertLead(db: Db, buyer: Buyer, leadId: string | undefined, offer: Offer, stage: Lead["stage"]): Lead {
  const email = buyer.email?.toLowerCase();
  let lead =
    (leadId ? db.leads.find((l) => l.id === leadId) : undefined) ??
    (email ? db.leads.find((l) => l.email?.toLowerCase() === email) : undefined) ??
    (buyer.business ? findDuplicate(db.leads, { name: buyer.business, website: buyer.website }) : undefined);
  if (!lead) {
    lead = {
      id: newId("lead"),
      name: buyer.business || buyer.name || buyer.email || "Store customer",
      niche: matchNiche(buyer.business)?.id ?? "custom",
      website: buyer.website,
      email: buyer.email,
      phone: buyer.phone,
      contactName: buyer.name,
      source: "store",
      stage,
      tags: ["Store"],
      notes: buyer.notes,
      createdBy: "store",
      createdAt: now(),
      updatedAt: now(),
    };
    db.leads.unshift(lead);
  } else {
    lead.email ??= buyer.email;
    lead.phone ??= buyer.phone;
    lead.website ??= buyer.website;
    lead.contactName ??= buyer.name;
    const rank = ["new", "contacted", "replied", "meeting", "proposal", "won", "lost"];
    if (rank.indexOf(stage) > rank.indexOf(lead.stage) || lead.stage === "lost") lead.stage = stage;
    lead.tags = [...new Set([...(lead.tags ?? []), "Store"])];
    lead.updatedAt = now();
  }
  lead.nextStep = stage === "won" ? "Onboarding: book the kickoff call" : `Finish checkout for ${offer.name}`;
  return lead;
}

export async function createPendingOrder(input: {
  offer: Offer;
  price: Price;
  currency: string;
  provider: PaymentProvider;
  buyer: Buyer;
  leadId?: string;
}): Promise<Order> {
  return update((db) => {
    const { offer, price, buyer } = input;
    const lead = upsertLead(db, buyer, input.leadId, offer, "proposal");
    const order: Order = {
      id: newId("ord"),
      provider: input.provider,
      offerId: offer.id,
      offerName: offer.name,
      interval: price.interval,
      amount: price.recurring,
      setupFee: price.setupCharged,
      currency: input.currency,
      status: "pending",
      ...buyer,
      leadId: lead.id,
      payments: [],
      createdAt: now(),
      updatedAt: now(),
    };
    db.orders.unshift(order);
    pushActivity(db, {
      kind: "lead",
      text: `${lead.name} started checkout for ${offer.name} (${price.interval === "year" ? "yearly" : "monthly"})`,
      leadId: lead.id,
    });
    return structuredClone(order);
  });
}

export async function setProviderRef(orderId: string, patch: Pick<Order, "providerRef"> & Partial<Pick<Order, "subscriptionId">>): Promise<void> {
  await update((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (o) Object.assign(o, patch, { updatedAt: now() });
  });
}

export interface Activation extends Buyer {
  subscriptionId?: string;
  customerId?: string;
  providerRef?: string;
  /** First payment, in dollars. */
  amountPaid?: number;
  paymentRef?: string;
}

/** Mark an order paid. Safe to call twice: returns activatedNow=false the second time. */
export async function activateOrder(m: OrderMatch, a: Activation): Promise<{ order?: Order; activatedNow: boolean }> {
  return update((db) => {
    const order = find(db, m);
    if (!order) return { order: undefined, activatedNow: false };
    for (const k of ["subscriptionId", "customerId", "providerRef"] as const) if (a[k]) order[k] = a[k];
    for (const k of ["email", "name", "phone"] as const) if (a[k] && !order[k]) order[k] = a[k];
    if (a.amountPaid && a.amountPaid > 0 && !(a.paymentRef && order.payments.some((p) => p.ref === a.paymentRef))) {
      order.payments.push({ at: now(), amount: a.amountPaid, ref: a.paymentRef });
    }
    order.updatedAt = now();
    if (order.status === "active") return { order: structuredClone(order), activatedNow: false };
    order.status = "active";
    order.activatedAt ??= now();
    const offer = getOffer(order.offerId);
    order.fulfillment ??= { status: "queued", steps: offer ? plannedSteps(offer) : [], updatedAt: now() };
    const lead = offer ? upsertLead(db, order, order.leadId, offer, "won") : undefined;
    if (lead) {
      order.leadId = lead.id;
      lead.value = Math.round(monthlyEquivalent(order));
      lead.tags = [...new Set([...(lead.tags ?? []), "Customer"])];
    }
    pushActivity(db, {
      kind: "stage",
      text: `New sale: ${order.business || order.name || order.email || "a customer"} bought ${order.offerName} (${order.interval === "year" ? `${order.currency.toUpperCase()} ${order.amount}/yr` : `${order.currency.toUpperCase()} ${order.amount}/mo`})`,
      leadId: lead?.id,
    });
    return { order: structuredClone(order), activatedNow: true };
  });
}

export async function recordPayment(m: OrderMatch, amount: number, ref?: string): Promise<Order | undefined> {
  return update((db) => {
    const order = find(db, m);
    if (!order || amount <= 0) return undefined;
    if (ref && order.payments.some((p) => p.ref === ref)) return structuredClone(order);
    order.payments.push({ at: now(), amount, ref });
    if (order.status === "past_due") order.status = "active";
    order.updatedAt = now();
    return structuredClone(order);
  });
}

export async function setOrderStatus(m: OrderMatch, status: OrderStatus, note?: string): Promise<Order | undefined> {
  return update((db) => {
    const order = find(db, m);
    if (!order || order.status === status) return order ? structuredClone(order) : undefined;
    const was = order.status;
    order.status = status;
    order.updatedAt = now();
    if (status === "canceled") order.canceledAt = now();
    const lead = order.leadId ? db.leads.find((l) => l.id === order.leadId) : undefined;
    if (status === "canceled" && was === "active" && lead) {
      lead.nextStep = "Cancelled: ask why and offer a win-back";
      db.tasks.unshift({ id: newId("task"), title: `${order.business ?? lead.name} cancelled ${order.offerName}: call to ask why`, leadId: lead.id, done: false, createdBy: "store", createdAt: now() });
    }
    if (status === "past_due" && lead) {
      db.tasks.unshift({ id: newId("task"), title: `Payment failed for ${order.business ?? lead.name} (${order.offerName}): check in`, leadId: lead.id, done: false, createdBy: "store", createdAt: now() });
    }
    if (was !== "pending" || status !== "canceled") {
      pushActivity(db, { kind: "stage", text: `${order.business || order.email || "Order"}: ${order.offerName} is now ${status.replace("_", " ")}${note ? ` (${note})` : ""}`, leadId: order.leadId });
    }
    return structuredClone(order);
  });
}

/** Providers retry webhooks; true the first time an event id is seen. */
export async function firstTimeSeen(eventId: string): Promise<boolean> {
  return update((db) => {
    if (db.payments.seenEvents.includes(eventId)) return false;
    db.payments.seenEvents.push(eventId);
    return true;
  });
}

/** A handler failed: let the provider's retry be processed. */
export async function forgetEvent(eventId: string): Promise<void> {
  await update((db) => {
    db.payments.seenEvents = db.payments.seenEvents.filter((e) => e !== eventId);
  }).catch(() => undefined);
}

/** A visitor left their details (with the sales assistant or the contact form): a hot inbound lead and a callback task. */
export async function captureStoreLead(buyer: Buyer, interest?: string): Promise<Lead> {
  return update((db) => {
    const offer = interest ? getOffer(interest.split(",")[0].trim()) : undefined;
    const lead = upsertLead(db, buyer, undefined, offer ?? { name: "a plan" } as Offer, "replied");
    lead.tags = [...new Set([...(lead.tags ?? []), "Inbound"])];
    const note = [buyer.notes, interest ? `Interested in: ${interest}` : ""].filter(Boolean).join(" · ");
    if (note) lead.notes = lead.notes ? `${lead.notes}\n${note}` : note;
    lead.nextStep = "Call back: they asked to hear from you";
    db.tasks.unshift({
      id: newId("task"),
      title: `Call back ${buyer.name ?? "store visitor"}${buyer.business ? ` (${buyer.business})` : ""}${offer ? `: asked about ${offer.name}` : ""}`,
      leadId: lead.id,
      due: now(),
      done: false,
      createdBy: "store",
      createdAt: now(),
    });
    pushActivity(db, { kind: "lead", text: `New inbound lead from your store: ${lead.name}${offer ? ` (${offer.name})` : ""}`, leadId: lead.id });
    return structuredClone(lead);
  });
}
