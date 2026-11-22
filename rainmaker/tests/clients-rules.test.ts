import { test } from "node:test";
import assert from "node:assert/strict";
import { automation, canMessage, firstName, inSendingHours, isOptIn, isOptOut, localTime, needsOptOutReply, pickChannel, quietHoursFor, render, sendDaysFor, smsSegments } from "../src/lib/clients/rules.ts";
import { enroll, MIN_GAP_HOURS, planDue, stopEnrollments, STOP_ON_REPLY } from "../src/lib/clients/schedule.ts";
import { costIndex, formatMoney, humanMonthly, localJobValue, niceRound, quote, quoteService, usdValueFrom, wagesFor } from "../src/lib/clients/pricing.ts";
import { emptyClientData } from "../src/lib/clients/data-core.ts";
import { defaultSequence, identifiedText } from "../src/lib/clients/templates.ts";
import { SERVICES } from "../src/lib/clients/services.ts";
import { COUNTRIES } from "../src/lib/markets.ts";
import { USD_PER_UNIT, WAGES } from "../src/lib/labor-data.ts";
import { RULES } from "../src/lib/compliance-data.ts";
import type { Client, ClientSettings, Contact, ServiceId, ServiceState } from "../src/lib/types.ts";

const settings = (p: Partial<ClientSettings> = {}): ClientSettings => ({
  callFlow: "forwarded", ringSeconds: 20, textBack: true, textBackMessage: "", aiReplies: true, autoSend: true, dailyCap: 3,
  quietStart: 9, quietEnd: 20, sendDays: "every", reviewDelayHours: 2, referralOffer: "", reactivationOffer: "", nurtureGoal: "Book", whatsapp: false, ...p,
});

function contact(p: Partial<Contact> = {}): Contact {
  return { id: "c1", ref: "abcdef", name: "Ana López", phone: "+14165550100", email: "ana@example.com", source: "import", status: "new", consent: { email: true, sms: true, basis: "written" }, enrollments: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...p };
}

// ── Opt-outs, consent and hours ───────────────────────────────

test("opt-outs: stop words in any language, plain requests, and not 'cancel my appointment'", () => {
  for (const t of ["STOP", "stop", "Stop.", "STOP please", "unsubscribe", "Opt out", "REVOKE", "quit", "stop texting me", "Please don't text me again", "don’t message me", "remove me from your list", "wrong number"]) assert.equal(isOptOut(t, "US"), true, t);
  for (const t of ["ALTO", "Baja", "no me escriban más", "no más mensajes"]) assert.equal(isOptOut(t, "MX"), true, t);
  for (const t of ["ARRÊT", "arret", "Désabonner", "ne m'écrivez plus"]) assert.equal(isOptOut(t, "CA"), true, t);
  for (const t of ["ALTO", "Baja", "ARRÊT", "afmelden"]) assert.equal(isOptOut(t, "CA") && isOptOut(t, "US") && isOptOut(t, "JM"), true, `${t} stops messages in every country`);
  for (const t of ["Cancel my appointment please", "end of the month works", "Can I stop by at 3?", "Stop by tomorrow?", "Yes please book me", "What's the price?", ""]) assert.equal(isOptOut(t, "US"), false, t);
  assert.equal(isOptOut("CANCEL", "US"), true, "a bare CANCEL is an opt-out");
  assert.equal(isOptIn("START"), true);
  assert.equal(isOptIn("start please"), false);
  assert.equal(needsOptOutReply("STOP", "US"), false, "Twilio answers STOP on US numbers");
  assert.equal(needsOptOutReply("ALTO", "US"), true, "but not ALTO");
  assert.equal(needsOptOutReply("STOP", "MX"), true);
});

test("consent: marketing needs permission per channel; answering someone who reached out doesn't", () => {
  const noText = contact({ consent: { email: true, sms: false, basis: "customer" } });
  assert.deepEqual(canMessage(noText, "sms", "reactivation"), { ok: false, reason: "No permission to text" });
  assert.equal(canMessage(noText, "email", "reactivation").ok, true);
  assert.equal(canMessage(noText, "sms", "reply").ok, true, "replying to their text is fine");
  assert.equal(canMessage(noText, "sms", "missed_call").ok, true, "texting back a missed call is fine");
  assert.equal(canMessage(contact({ consent: { email: false, sms: false, basis: "form" } }), "sms", "nurture").ok, false, "follow-ups need the texting box ticked");
  const out = contact({ status: "opted_out", optedOutAt: "2026-11-02T00:00:00Z" });
  assert.equal(canMessage(out, "sms", "reply").ok, false, "never after an opt-out");
  assert.equal(canMessage(out, "sms", "opt_out").ok, true, "except the one confirmation");
  assert.equal(canMessage(contact({ phone: undefined }), "sms", "reply").ok, false);
  const c: Pick<Client, "settings" | "whatsappNumber"> = { settings: settings({ whatsapp: true }), whatsappNumber: "+15555550123" };
  assert.equal(pickChannel(contact(), "review", c), "whatsapp", "WhatsApp where the client uses it");
  assert.equal(pickChannel(noText, "review", c), "email");
  assert.equal(pickChannel(contact({ email: undefined, consent: { email: false, sms: false, basis: "none" } }), "review", c), undefined);
});

test("sending hours follow the client's own time zone", () => {
  const c = { timezone: "America/Toronto", settings: settings({ quietStart: 9, quietEnd: 20 }) };
  assert.equal(inSendingHours(new Date("2026-11-20T15:00:00Z"), c), true, "10am in Toronto");
  assert.equal(inSendingHours(new Date("2026-11-21T02:00:00Z"), c), false, "9pm in Toronto");
  assert.equal(inSendingHours(new Date("2026-11-20T13:30:00Z"), { ...c, timezone: "America/Vancouver" }), false, "5:30am in Vancouver");
  assert.deepEqual(localTime(new Date("2026-11-20T05:30:00Z"), "America/Mexico_City"), { day: "2026-11-19", hour: 23, minute: 30, weekday: 4 });
  assert.equal(inSendingHours(new Date("2026-11-20T23:00:00Z"), { timezone: "UTC", settings: settings({ quietStart: 22, quietEnd: 6 }) }), true, "a window across midnight");
  const us = quietHoursFor("US");
  assert.ok(us.start >= 8 && us.end <= 21, "US defaults sit inside the federal 8am-9pm rule");
  assert.deepEqual(quietHoursFor("ZZ"), { start: 9, end: 20 }, "unknown country: a safe default");
  // Sunday 22 Nov 2026, noon in New York; Saturday 21 Nov, noon in Guadeloupe.
  const ny = { timezone: "America/New_York", country: "US", settings: settings({ quietStart: 10, quietEnd: 18, sendDays: sendDaysFor("US") }) };
  assert.equal(sendDaysFor("US"), "mon_sat");
  assert.equal(inSendingHours(new Date("2026-11-22T17:00:00Z"), ny), false, "no Sunday texts in the US");
  assert.equal(inSendingHours(new Date("2026-11-21T17:00:00Z"), ny), true, "Saturday is fine");
  const gp = { timezone: "America/Guadeloupe", country: "GP", settings: settings({ quietStart: 10, quietEnd: 20, sendDays: sendDaysFor("GP") }) };
  assert.equal(inSendingHours(new Date("2026-11-21T16:00:00Z"), gp), false, "weekdays only under French rules");
  assert.equal(inSendingHours(new Date("2026-11-20T17:30:00Z"), gp), false, "and not over lunch (13:30)");
  assert.equal(inSendingHours(new Date("2026-11-20T19:00:00Z"), gp), true, "Friday 15:00");
  assert.equal(localTime(new Date("2026-11-22T17:00:00Z"), "America/New_York").weekday, 0);
});

test("automation: off does nothing, setup drafts, live sends unless approvals are on", () => {
  const services = (s: ServiceState["status"], included = true) => ({ speed_to_lead: { status: s, included } }) as Record<ServiceId, ServiceState>;
  assert.equal(automation({ services: services("off"), settings: settings() }, "speed_to_lead"), "off");
  assert.equal(automation({ services: services("setup"), settings: settings() }, "speed_to_lead"), "draft");
  assert.equal(automation({ services: services("live"), settings: settings({ autoSend: true }) }, "speed_to_lead"), "send");
  assert.equal(automation({ services: services("live"), settings: settings({ autoSend: false }) }, "speed_to_lead"), "draft");
  assert.equal(automation({ services: services("live", false), settings: settings() }, "speed_to_lead"), "off", "not in their plan");
  assert.equal(automation({ services: services("paused"), settings: settings() }, "speed_to_lead"), "off");
});

test("placeholders: names drop out cleanly; missing links hold the message", () => {
  assert.deepEqual(render("Hi {first_name}, it's {business}.", { first_name: "Ana", business: "Sol" }), { text: "Hi Ana, it's Sol.", missing: [] });
  assert.equal(render("Hi {first_name}, it's {business}.", { business: "Sol" }).text, "Hi, it's Sol.");
  assert.deepEqual(render("Review us: {review_link}", {}).missing, ["review_link"]);
  assert.equal(render("Keep {unknown} as is", {}).text, "Keep {unknown} as is");
  assert.equal(firstName("ana maría lópez"), "Ana");
  assert.equal(firstName("+1 416 555"), "");
  assert.deepEqual(smsSegments("Hello there"), { segments: 1, unicode: false, chars: 11 });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("¿Cómo está?").unicode, true, "ó isn't in the GSM alphabet");
  assert.equal(smsSegments("é".repeat(100)).unicode, false, "é is");
});

// ── The scheduler ─────────────────────────────────────────────

function setup(n = 5) {
  const data = emptyClientData("cli_s");
  const t = defaultSequence("reactivation", "en", { business: "Sol" });
  data.sequences.push({ id: "seq_r", kind: "reactivation", name: t.name, status: "running", steps: t.steps, createdBy: "template", createdAt: "", updatedAt: "" });
  for (let i = 0; i < n; i++) {
    const c = contact({ id: `c${i}`, ref: `ref00${i}`, phone: `+1416555010${i}`, name: `Person ${i}` });
    enroll(c, data.sequences[0], new Date(`2026-11-20T1${i}:00:00Z`));
    data.contacts.push(c);
  }
  return data;
}

const client = { timezone: "America/Toronto", settings: settings({ dailyCap: 3 }), whatsappNumber: undefined };
const vars = (c: Contact) => ({ first_name: c.name.split(" ")[0], business: "Sol", booking_link: "https://sol.test/book" });

test("scheduler: oldest first, within the daily cap, rendered per person", () => {
  const data = setup(5);
  const plan = planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars);
  assert.equal(plan.sends.length, 3, "daily cap of 3");
  assert.equal(plan.held, "daily_cap");
  assert.deepEqual(plan.sends.map((s) => s.contactId), ["c0", "c1", "c2"]);
  assert.equal(plan.sends[0].channel, "sms");
  assert.match(plan.sends[0].body, /^Hi Person, it's Sol/);
  assert.deepEqual(plan.sends[0].missing, []);
  data.daily["2026-11-21"] = { sent: 3, views: 0 };
  assert.equal(planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars).sends.length, 0, "cap used up today");
});

test("scheduler: quiet hours, the per-person gap, finished and unreachable enrollments", () => {
  const data = setup(2);
  assert.equal(planDue(client, data, new Date("2026-11-21T06:00:00Z"), vars).held, "quiet_hours", "1am in Toronto");
  data.contacts[0].lastOutboundAt = "2026-11-21T10:00:00Z";
  const soon = planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars);
  assert.deepEqual(soon.sends.map((s) => s.contactId), ["c1"], `nobody gets two messages within ${MIN_GAP_HOURS}h`);
  data.contacts[1].enrollments[0].next = 99;
  data.contacts[0].consent = { email: false, sms: false, basis: "none" };
  data.contacts[0].lastOutboundAt = undefined;
  const p = planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars);
  assert.deepEqual(p.finish.map((f) => [f.contactId, f.stop]).sort(), [["c0", "no_channel"], ["c1", "finished"]]);
  assert.equal(p.sends.length, 0);
});

test("scheduler: steps wait for their delay; only the kinds asked for are planned", () => {
  const data = setup(1);
  const c = data.contacts[0];
  assert.equal(planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars).sends[0].step, 0);
  c.enrollments[0].next = 1;
  assert.equal(planDue(client, data, new Date("2026-11-21T15:00:00Z"), vars).sends.length, 0, "step 2 is 48h after enrollment");
  assert.equal(planDue(client, data, new Date("2026-11-22T15:00:00Z"), vars).sends[0].step, 1);
  assert.equal(planDue(client, data, new Date("2026-11-22T15:00:00Z"), vars, { kinds: ["review"] }).sends.length, 0);
  data.sequences[0].status = "paused";
  assert.equal(planDue(client, data, new Date("2026-11-22T15:00:00Z"), vars).sends.length, 0, "a paused campaign sends nothing");
});

test("texts say who's writing and how to stop: every one in Canada, the first one elsewhere", () => {
  const later = "Just making sure you saw this. We have openings this week. Want one?";
  assert.equal(identifiedText(later, { business: "Sol Dental", lang: "en", country: "CA", first: false }), "Sol Dental: Just making sure you saw this. We have openings this week. Want one? Reply STOP to opt out.");
  assert.equal(identifiedText(later, { business: "Sol Dental", lang: "en", country: "US", first: false }), later, "later US texts are left alone");
  const first = "Hi Ana, it's Sol Dental. Reply STOP to opt out.";
  assert.equal(identifiedText(first, { business: "Sol Dental", lang: "en", country: "US", first: true }), first, "nothing to add");
  assert.equal(identifiedText("¿Le podemos ayudar?", { business: "Sol", lang: "es", country: "MX", first: true }), "Sol: ¿Le podemos ayudar? Responda STOP para no recibir más mensajes.");
  assert.match(identifiedText("Sol here. Stop by any time!", { business: "Sol", lang: "en", country: "CA", first: false }), /Reply STOP to opt out\.$/, "“stop by” isn't an opt-out instruction");

  const data = setup(1);
  data.contacts[0].enrollments[0].next = 1;
  const ca = planDue({ ...client, name: "Sol", lang: "en", country: "CA" }, data, new Date("2026-11-22T15:00:00Z"), vars);
  assert.match(ca.sends[0].body, /^Sol: .*Reply STOP to opt out\.$/);
  const us = planDue({ ...client, name: "Sol", lang: "en", country: "US", timezone: "America/New_York" }, data, new Date("2026-11-23T16:00:00Z"), vars);
  assert.doesNotMatch(us.sends[0].body, /STOP/);
});

test("enrollment: no doubles, no opted-out people, replies stop follow-ups but not review asks", () => {
  const c = contact();
  const seq = { id: "s1", kind: "nurture" as const };
  assert.equal(enroll(c, seq, new Date()), true);
  assert.equal(enroll(c, seq, new Date()), false, "already on it");
  enroll(c, { id: "s2", kind: "review" }, new Date());
  assert.equal(stopEnrollments(c, "replied", new Date(), STOP_ON_REPLY), 1);
  assert.equal(c.enrollments.find((e) => e.seqId === "s2")?.stoppedAt, undefined, "the review ask carries on");
  assert.equal(enroll(c, seq, new Date()), false, "a finished follow-up never restarts");
  assert.equal(enroll(contact({ optedOutAt: "2026-01-01" }), seq, new Date()), false);
});

// ── Prices ────────────────────────────────────────────────────

test("wage data: every market has wages, a burden, sources and an exchange rate", () => {
  assert.equal(WAGES.length, COUNTRIES.length);
  for (const c of COUNTRIES) {
    const w = WAGES.find((x) => x.country === c.code);
    assert.ok(w, `${c.name} has wages`);
    assert.equal(w!.currency, c.currency, `${c.name} wages are in its own currency`);
    assert.ok(USD_PER_UNIT[w!.currency] > 0, `${w!.currency} has an exchange rate`);
    assert.ok(w!.burden >= 1 && w!.burden < 2, `${c.name} burden is sane`);
    assert.ok(w!.sources.length > 0, `${c.name} cites a source`);
    for (const [role, rate] of Object.entries(w!.hourly)) assert.ok(rate > 0, `${c.name} ${role}`);
  }
  assert.equal(RULES.length, COUNTRIES.length, "and messaging rules");
});

test("prices: never above what a person costs in the US, bundle cheaper than the parts", () => {
  const us = wagesFor("US");
  for (const s of SERVICES) {
    const q = quoteService(s, us);
    assert.ok(q.price <= q.humanMonthly || q.personCheaper, `${s.id}: ${q.price} vs a person at ${q.humanMonthly}`);
    assert.ok(q.price >= q.floor, `${s.id} covers delivery`);
    assert.equal(q.price, s.price.monthly, `${s.id} keeps its US list price`);
  }
  const all = quote("US");
  assert.equal(all.currency, "usd");
  assert.equal(all.lines.length, 7);
  assert.ok(all.monthly < all.listMonthly, "the bundle discount");
  assert.ok(all.share < 0.6, `the full team costs well under half of the people it replaces (${Math.round(all.share * 100)}%)`);
  assert.ok(all.fte >= 1, "about one full-time person's worth of work");
  const two = quote("US", ["website", "reviews"]);
  assert.equal(two.monthly, two.listMonthly, "no bundle price for a partial selection");
  assert.equal(humanMonthly(SERVICES[4], us), 86 * us.hourly.receptionist * us.burden);
});

test("prices: other markets scale to local wages and currency, and flag where a person is cheaper", () => {
  const mx = quote("MX");
  assert.equal(mx.currency, "mxn");
  const usd = (n: number, cur: string) => n * USD_PER_UNIT[cur];
  assert.ok(usd(mx.monthly, "mxn") < quote("US").monthly, "cheaper than the US in dollars");
  const ca = quote("CA");
  assert.equal(ca.currency, "cad");
  for (const code of ["HT", "NI", "CU"]) {
    const q = quote(code);
    assert.ok(q.lines.every((l) => l.price >= l.floor), `${code} never prices below delivery cost`);
  }
  assert.ok(COUNTRIES.some((c) => quote(c.code).lines.some((l) => l.personCheaper)), "somewhere delivery costs more than a person, and the quote says so");
  assert.equal(niceRound(296.4, "usd"), 297);
  assert.equal(niceRound(1496, "usd"), 1497);
  assert.equal(niceRound(5012, "mxn"), 4990);
  assert.equal(niceRound(0, "usd"), 0);
  assert.equal(usdValueFrom("$1,000–$3,000+ per new patient"), 1000);
  assert.equal(usdValueFrom("$8k jobs"), 8000);
  assert.equal(usdValueFrom("Varies"), 300);
  assert.ok(costIndex("US") === 1 && costIndex("MX") < 1);
  assert.ok(localJobValue("$1,000 per patient", "MX") > 1000, "pesos: a bigger number, a smaller value");
  assert.match(formatMoney(1497, "usd", "en-US"), /^\$1,497$/);
  assert.match(formatMoney(4990, "mxn", "es-MX"), /4,990/);
  assert.match(formatMoney(100, "xcg", "en-US"), /100/, "a new currency still formats");
});
