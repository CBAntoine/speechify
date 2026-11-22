import { test } from "node:test";
import assert from "node:assert/strict";
import { casClientData, emptyClientData, normalizeClientData, trimClientData, LIMITS, type DocBackend } from "../src/lib/clients/data-core.ts";
import { mapHeader, parseCsv, parseDate, readContacts } from "../src/lib/clients/csv.ts";
import { parseTranscript, rulesScorecard, transcriptMetrics } from "../src/lib/clients/coach.ts";
import { formatDuration, monthPeriod, results } from "../src/lib/clients/metrics.ts";
import { candidateUrls, dial, missedLine, say, sayLanguage, twilioSignature, twiml, unanswered, validTwilioSignature } from "../src/lib/clients/twilio-core.ts";
import { defaultSequence, emailFooter, l3, nicheWord, ownerAlert, stopLine, templateSite, textBackTemplate } from "../src/lib/clients/templates.ts";
import { SERVICES, missingFoundations, nextService, pitchFor, serviceById } from "../src/lib/clients/services.ts";
import { NICHES } from "../src/lib/niches.ts";
import type { ClientData, Contact } from "../src/lib/types.ts";

// ── Per-client storage ────────────────────────────────────────

function memoryBackend(): DocBackend & { saves: number } {
  const docs = new Map<string, { doc: ClientData; version: number }>();
  const b = {
    kind: "file" as const,
    saves: 0,
    async load(id: string) {
      const hit = docs.get(id);
      return hit ? { doc: structuredClone(hit.doc), version: hit.version } : { doc: emptyClientData(id), version: 0 };
    },
    async save(id: string, doc: ClientData, version: number) {
      const hit = docs.get(id);
      if ((hit?.version ?? 0) !== version) return null;
      docs.set(id, { doc: structuredClone(doc), version: version + 1 });
      b.saves++;
      return version + 1;
    },
    async remove(id: string) {
      docs.delete(id);
    },
  };
  return b;
}

test("client data: compare-and-set never loses a concurrent write", async () => {
  const b = memoryBackend();
  const add = (n: number) =>
    casClientData(b, "cli_x", (d) => {
      d.calls.unshift({ id: `call_${n}`, at: new Date().toISOString(), outcome: "missed" });
    });
  await Promise.all(Array.from({ length: 12 }, (_, i) => add(i)));
  const { doc } = await b.load("cli_x");
  assert.equal(doc.calls.length, 12, "every write landed");
  assert.equal(new Set(doc.calls.map((c) => c.id)).size, 12);
});

test("client data: old documents are filled in, and lists are kept to size", () => {
  const raw = { contacts: [{ id: "ct_1", name: "Ana" }] } as unknown as Partial<ClientData>;
  const d = normalizeClientData(raw, "cli_a");
  assert.equal(d.clientId, "cli_a");
  assert.deepEqual(d.contacts[0].enrollments, []);
  assert.equal(d.contacts[0].consent.sms, false);
  assert.deepEqual(d.daily, {});
  const big = emptyClientData("cli_b");
  big.messages = Array.from({ length: LIMITS.messages + 10 }, (_, i) => ({ id: `m${i}`, contactId: "c", channel: "sms", direction: "out", purpose: "manual", body: "", by: "staff", status: "sent", at: "" }) as ClientData["messages"][number]);
  for (let i = 0; i < LIMITS.days + 5; i++) big.daily[`2025-01-${String(i).padStart(3, "0")}`] = { sent: 1, views: 0 };
  trimClientData(big);
  assert.equal(big.messages.length, LIMITS.messages);
  assert.equal(big.messages[0].id, "m10", "the oldest messages go first");
  assert.equal(Object.keys(big.daily).length, LIMITS.days);
});

// ── Customer list import ──────────────────────────────────────

test("CSV: quotes, separators and a byte-order mark", () => {
  assert.deepEqual(parseCsv('﻿name,phone\n"Smith, Jo","(416) 555-0199"\n'), [["name", "phone"], ["Smith, Jo", "(416) 555-0199"]]);
  assert.deepEqual(parseCsv("nombre;teléfono\r\nAna;81 1234 5678\r\n"), [["nombre", "teléfono"], ["Ana", "81 1234 5678"]]);
  assert.deepEqual(parseCsv('a\tb\n"x ""y"""\tz'), [["a", "b"], ['x "y"', "z"]]);
});

test("CSV: headers in English, Spanish and French", () => {
  assert.deepEqual(mapHeader(["First Name", "Last Name", "Mobile", "E-mail", "Last visit"]), { first: 0, last: 1, phone: 2, email: 3, lastVisit: 4 });
  assert.deepEqual(mapHeader(["Nombre", "Celular", "Correo electrónico", "Última visita", "Servicio"]), { name: 0, phone: 1, email: 2, lastVisit: 3, interest: 4 });
  assert.deepEqual(mapHeader(["Nom complet", "Téléphone", "Courriel", "Dernière visite"]), { name: 0, phone: 1, email: 2, lastVisit: 3 });
});

test("CSV: contacts are normalized, deduplicated and bad rows reported", () => {
  const csv = [
    "Customer,Phone,Email,Last appointment",
    "Jo Smith,(416) 555-0199,jo@example.com,03/15/2024",
    "Jo Smith again,416-555-0199,,",
    "No Contact,,,",
    "Bad Phone,12,,",
    "Email Only,,email.only@example.ca,2024-01-02",
  ].join("\n");
  const r = readContacts(csv, "CA");
  assert.equal(r.total, 5);
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], { name: "Jo Smith", phone: "+14165550199", email: "jo@example.com", lastVisit: "2024-03-15", interest: undefined, notes: undefined });
  assert.equal(r.rows[1].email, "email.only@example.ca");
  assert.equal(r.duplicates, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [4, 5]);
  assert.equal(r.columns.phone, "Phone");
});

test("CSV: Mexican lists use day-first dates and +52 numbers; no header row is sniffed", () => {
  const r = readContacts("Nombre,Teléfono,Fecha\nAna López,81 1234 5678,05/11/2025\n", "MX");
  assert.equal(r.rows[0].phone, "+528112345678");
  assert.equal(r.rows[0].lastVisit, "2025-11-05", "5 November, day first");
  const bare = readContacts("Luis,luis@example.mx,55 1234 5678\nMara,mara@example.mx,33 9876 5432\n", "MX");
  assert.equal(bare.rows.length, 2);
  assert.equal(bare.rows[0].email, "luis@example.mx");
  assert.equal(bare.rows[1].phone, "+523398765432");
  assert.equal(parseDate("13/02/2024", true), "2024-02-13", "a day over 12 can only be day-first");
  assert.equal(parseDate("02/13/2024", false), "2024-02-13");
  assert.equal(parseDate("nonsense"), undefined);
});

// ── Sales coaching ────────────────────────────────────────────

const CALL = `Rep: Thanks for calling Lakeside Dental, this is Sam. How can I help?
Customer: Hi, I'm Dana. I have a toothache and wanted to know how much a visit is.
Rep: Sorry to hear that, Dana. How long has it been hurting?
Customer: About two days. It's on the left side.
Rep: Is it sharp, or more of a dull ache? And is it worse with cold drinks?
Customer: Sharp, especially with cold. Honestly it might be too expensive, I'll think about it.
Rep: I understand. Because pain like that can get worse, the exam includes X-rays so we find the cause the same day. Would tomorrow at 10 or Thursday at 3 work better?
Customer: Tomorrow at 10 works.
Rep: Great, you're booked for tomorrow at 10. I'll text you a confirmation.`;

test("transcripts: speakers, questions, booking and next step", () => {
  const turns = parseTranscript(CALL);
  assert.equal(turns.length, 9);
  assert.equal(turns[0].speaker, "rep");
  assert.equal(turns[1].speaker, "customer");
  const m = transcriptMetrics(turns);
  assert.ok(m.repQuestions >= 4, `counted ${m.repQuestions} questions`);
  assert.equal(m.askedForBooking, true);
  assert.equal(m.mentionedPrice, true);
  assert.equal(m.nextStepSet, true);
  assert.equal(m.usedName, true, "Dana gave her name and the rep used it");
  assert.ok(m.repShare > 40 && m.repShare < 75);
  const card = rulesScorecard(turns, m, "en");
  assert.equal(card.by, "rules");
  assert.ok(card.overall >= 70, `a good call scores well (${card.overall})`);
  assert.equal(card.scores.find((s) => s.id === "close")?.score, 5);
  assert.equal(card.scores.find((s) => s.id === "objections")?.score, 4, "met the price objection with value and a question");
});

test("transcripts: a weak call gets specific fixes, in the client's language", () => {
  const weak = "Agente: Bueno.\nCliente: Hola, ¿cuánto cuesta una limpieza?\nAgente: Son 800 pesos.\nCliente: Ok, lo pienso.\nAgente: Ok, gracias.";
  const turns = parseTranscript(weak);
  assert.equal(turns[0].speaker, "rep", "Agente is staff");
  const m = transcriptMetrics(turns);
  assert.equal(m.askedForBooking, false);
  const card = rulesScorecard(turns, m, "es");
  assert.ok(card.overall < 50);
  assert.ok(card.fixes.length >= 2);
  assert.ok(card.fixes.some((f) => f.issue === "Pedir la cita"));
  assert.match(card.summary, /No pidió la cita/);
});

test("transcripts: speaker labels from a recording, and the rep chosen by name", () => {
  const t = parseTranscript("Speaker 1: Good morning, Northstar Roofing.\nSpeaker 2: Hi, I need a quote.\n[00:12] Speaker 1: Sure, what's the address?");
  assert.deepEqual(t.map((x) => x.speaker), ["rep", "customer", "rep"]);
  const picked = parseTranscript("Maria: hello?\nJohn: Hi Maria, this is John from Summit HVAC.", "John");
  assert.equal(picked[1].speaker, "rep");
});

// ── Results ───────────────────────────────────────────────────

function contact(p: Partial<Contact>): Contact {
  return { id: "c", ref: "aaaaaa", name: "X", source: "website", status: "new", consent: { email: true, sms: true, basis: "form" }, enrollments: [], createdAt: "2026-11-03T10:00:00Z", updatedAt: "2026-11-03T10:00:00Z", ...p };
}

test("results: leads answered and how fast, calls caught, bookings and revenue", () => {
  const d = emptyClientData("cli_r");
  d.contacts = [
    contact({ id: "a", createdAt: "2026-11-03T10:00:00Z", firstReplyAt: "2026-11-03T10:00:20Z", bookedAt: "2026-11-04T09:00:00Z" }),
    contact({ id: "b", createdAt: "2026-11-05T22:00:00Z", firstReplyAt: "2026-11-05T22:01:00Z" }),
    contact({ id: "c2", source: "call", createdAt: "2026-11-06T12:00:00Z", lastInboundAt: "2026-11-06T12:05:00Z" }),
    contact({ id: "old", source: "import", createdAt: "2026-10-01T00:00:00Z", bookedAt: "2026-11-10T00:00:00Z", value: 900, enrollments: [{ seqId: "s", kind: "reactivation", startedAt: "2026-11-02T00:00:00Z", next: 1 }] }),
    contact({ id: "prev", createdAt: "2026-10-20T00:00:00Z" }),
  ];
  d.calls = [
    { id: "k1", at: "2026-11-06T11:59:00Z", outcome: "missed", contactId: "c2", textedBack: true },
    { id: "k2", at: "2026-11-07T11:00:00Z", outcome: "answered" },
    { id: "k3", at: "2026-11-08T11:00:00Z", outcome: "ai", durationSec: 120 },
  ];
  d.messages = [
    { id: "m1", contactId: "old", channel: "sms", direction: "out", purpose: "reactivation", body: "hi", by: "template", status: "sent", at: "2026-11-02T15:00:00Z", sentAt: "2026-11-02T15:00:00Z" },
    { id: "m2", contactId: "old", channel: "sms", direction: "in", purpose: "reply", body: "yes!", by: "contact", status: "received", at: "2026-11-02T16:00:00Z" },
  ];
  d.daily = { "2026-11-03": { sent: 2, views: 40 }, "2026-10-30": { sent: 0, views: 99 } };
  const r = results({ jobValue: 300, adMonths: [{ month: "2026-11", spend: 600, leads: 20, booked: 5 }] }, d, monthPeriod("2026-11"));
  assert.equal(r.leads, 3, "website and call leads in November; the import isn't a lead");
  assert.equal(r.answered, 2);
  assert.equal(r.medianResponseSec, 40);
  assert.equal(r.fast, 2);
  assert.deepEqual(r.calls, { total: 3, answered: 1, ai: 1, missed: 1, textedBack: 1 });
  assert.equal(r.recoveredCalls, 1, "the missed caller replied after the text-back");
  assert.deepEqual(r.winback, { reached: 1, replied: 1, booked: 1 });
  assert.equal(r.booked, 2);
  assert.equal(r.revenue, 1200, "300 default + 900 known value");
  assert.equal(r.siteViews, 40);
  assert.deepEqual(r.ads, { spend: 600, leads: 20, booked: 5, costPerLead: 30, costPerBooking: 120 });
  assert.ok(r.hours > 0);
  assert.equal(formatDuration(40), "40s");
  assert.equal(formatDuration(600), "10 min");
  assert.equal(formatDuration(undefined), "–");
});

// ── Twilio ────────────────────────────────────────────────────

test("Twilio: request signatures match Twilio's documented example", () => {
  // From Twilio's webhook security docs.
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  assert.equal(twilioSignature(token, url, params), "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  assert.equal(validTwilioSignature(token, url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="), true);
  assert.equal(validTwilioSignature(token, url, { ...params, Digits: "9999" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="), false);
  assert.equal(validTwilioSignature(token, url, params, null), false);
  assert.deepEqual(candidateUrls("https://a.test:443/x"), ["https://a.test:443/x", "https://a.test/x"]);
  assert.deepEqual(candidateUrls("https://a.test/x?y=1"), ["https://a.test/x?y=1", "https://a.test:443/x?y=1"]);
  assert.deepEqual(candidateUrls("http://localhost:3100/x"), ["http://localhost:3100/x"]);
});

test("Twilio: TwiML for ringing staff, missed calls and the caller's language", () => {
  const x = twiml(dial(["+14165550100"], { timeout: 20, action: "https://x.test/after?c=1&d=2" }));
  assert.match(x, /^<\?xml/);
  assert.match(x, /<Dial timeout="20" action="https:\/\/x.test\/after\?c=1&amp;d=2" method="POST" answerOnBridge="true"><Number>\+14165550100<\/Number><\/Dial>/);
  assert.match(say("Tom & Jerry <3", "en-US"), /Tom &amp; Jerry &lt;3/);
  assert.equal(sayLanguage("es", "MX"), "es-MX");
  assert.equal(sayLanguage("es", "US"), "es-US");
  assert.equal(sayLanguage("fr", "CA"), "fr-CA");
  assert.equal(sayLanguage("fr", "HT"), "fr-FR");
  assert.equal(sayLanguage("en", "CA"), "en-CA");
  assert.equal(unanswered("no-answer"), true);
  assert.equal(unanswered("busy"), true);
  assert.equal(unanswered("completed"), false);
  assert.match(missedLine("es"), /mensaje de texto/);
});

// ── Templates ─────────────────────────────────────────────────

test("templates: every sequence, every language, with opt-out lines and placeholders", () => {
  for (const lang of ["en", "es", "fr"] as const) {
    for (const kind of ["nurture", "reactivation", "review", "referral"] as const) {
      const s = defaultSequence(kind, lang, { business: "Lakeside" });
      assert.ok(s.steps.length >= 1, `${kind}/${lang} has steps`);
      assert.ok(s.steps.every((x) => x.sms && x.email && x.subject), `${kind}/${lang} steps are complete`);
      for (let i = 1; i < s.steps.length; i++) assert.ok(s.steps[i].delayHours > s.steps[i - 1].delayHours, "steps go forward in time");
      if (kind !== "referral") assert.ok(s.steps[0].sms.includes(stopLine(lang)), `${kind}/${lang} first text says how to opt out`);
      assert.ok(s.steps.every((x) => !/\{(?!first_name|business|booking_link|review_link|referral_link|site_link|offer|phone)\w+\}/.test(x.sms + x.email)), "only known placeholders");
    }
  }
  assert.match(defaultSequence("review", "en", { business: "X" }).steps[0].sms, /\{review_link\}/);
  assert.match(defaultSequence("referral", "es", { business: "X", referralOffer: "10% de descuento" }).steps[0].sms, /10% de descuento/);
  assert.doesNotMatch(defaultSequence("review", "en", { business: "X" }).steps[0].sms, /5[- ]star/i, "never asks for a positive review");
  assert.doesNotMatch(defaultSequence("reactivation", "en", { business: "X" }).steps[0].sms, /This month:/, "no offer unless one is given");
  assert.match(defaultSequence("reactivation", "en", { business: "X", offer: "20% off a tune-up" }).steps[0].sms, /20% off a tune-up/);
});

test("templates: texts back, alerts, footers and the starter website", () => {
  assert.match(textBackTemplate("fr"), /\{business\}/);
  assert.equal(l3("nl"), "en", "Dutch falls back to English templates");
  assert.match(ownerAlert("new_lead", "es", { business: "Dental Sol", name: "Ana", seconds: 9 }), /Atendido en 9 s/);
  assert.match(emailFooter("en", "Lakeside", "1 Main St", "https://x.test/u"), /Unsubscribe: https:\/\/x.test\/u/);
  const dentist = NICHES.find((n) => n.id === "dentist")!;
  assert.equal(nicheWord(dentist, "es"), "dentista");
  const site = templateSite({ business: "Sonrisa Dental", niche: dentist, city: "Monterrey, NLE" }, "es");
  assert.equal(site.lang, "es");
  assert.match(site.headline, /Monterrey/);
  assert.equal(site.cta, "Agendar una cita");
  assert.deepEqual(site.testimonials, [], "a template never makes up reviews");
  assert.equal(site.offer, "", "or offers");
  assert.ok(site.seoTitle.length <= 60 && site.seoDescription.length <= 155);
  assert.match(site.colors.primary, /^#[0-9a-f]{6}$/);
  assert.equal(templateSite({ business: "X", brandColor: "#AA3300" }, "en").colors.primary, "#aa3300", "their own brand colour wins");
});

// ── The seven services ────────────────────────────────────────

test("services: seven, in the video's order, each replacing a job with a price", () => {
  assert.deepEqual(SERVICES.map((s) => s.id), ["website", "reactivation", "reviews", "speed_to_lead", "missed_calls", "sales_coach", "ads"]);
  assert.deepEqual(SERVICES.map((s) => s.step), [1, 2, 3, 4, 5, 6, 7]);
  for (const s of SERVICES) {
    assert.ok(s.hours > 0 && s.price.monthly > 0 && s.deliveryUsd > 0, s.id);
    for (const prev of s.after) assert.ok(serviceById(prev)!.step < s.step, `${s.id} only depends on earlier steps`);
    for (const lang of ["en", "es", "fr"] as const) assert.ok(pitchFor(s, lang).title && pitchFor(s, lang).promise, `${s.id} has ${lang} copy`);
    assert.doesNotMatch(Object.values(s.pitch).map((p) => p.title + p.promise).join(" "), /\bAI\b|\bIA\b|artificial|bot\b/i, `${s.id}'s client-facing copy sells the outcome, not the technology`);
  }
  const status = { website: { status: "live" }, speed_to_lead: { status: "setup" } };
  assert.deepEqual(missingFoundations("ads", status).map((s) => s.id), ["speed_to_lead", "missed_calls"], "ads wait for follow-up and call handling");
  assert.equal(nextService(status)?.id, "reactivation");
  assert.equal(nextService({})?.id, "website");
});
