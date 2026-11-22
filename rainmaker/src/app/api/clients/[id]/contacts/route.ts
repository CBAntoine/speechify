import { readContacts } from "@/lib/clients/csv";
import { readClientData, updateClientData } from "@/lib/clients/data-store";
import { LIMITS } from "@/lib/clients/data-core";
import { captureLead, findContact, markBooked, markJobsDone, newContact, processDue, startWinBack } from "@/lib/clients/engine";
import { getClient } from "@/lib/clients/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { toE164 } from "@/lib/phone";
import { siteUrl } from "@/lib/site";
import type { Consent, Contact, ContactStatus } from "@/lib/types";

export const maxDuration = 60;

/** Contacts, newest first: ?q= search, ?status=, ?offset=, ?limit= (max 200). */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const u = new URL(req.url).searchParams;
  const q = (u.get("q") ?? "").toLowerCase().trim();
  const status = u.get("status");
  const offset = Math.max(0, Number(u.get("offset")) || 0);
  const limit = Math.min(200, Math.max(1, Number(u.get("limit")) || 50));
  const data = await readClientData(id);
  const list = data.contacts.filter(
    (c) => (!status || c.status === status) && (!q || c.name.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q))
  );
  return Response.json({ contacts: list.slice(offset, offset + limit), total: list.length });
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

/**
 * { action: "preview" | "import", csv, consent: { sms, email }, source? }
 * { action: "add", name, phone?, email?, sms?, notes? }
 * { action: "test_lead" }
 * { action: "jobs_done", ids }  { action: "winback", ids, seqId? }
 * { action: "update", contactId, booked?, value?, sms?, email?, notes?, status?, needsHuman? }
 * { action: "delete", ids }
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const client = await getClient(id);
  if (!client) throw new HttpError(404, "Client not found");
  const b = await readBody<Record<string, unknown>>(req);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, LIMITS.contacts) : [];
  const ctx = { base: siteUrl(req) };

  switch (b.action) {
    case "preview":
    case "import": {
      if (typeof b.csv !== "string" || !b.csv.trim()) throw new HttpError(400, "Paste or upload the customer list first");
      const parsed = readContacts(b.csv, client.country);
      if (b.action === "preview") return Response.json({ ...parsed, rows: parsed.rows.slice(0, 8), count: parsed.rows.length });
      const c = (b.consent ?? {}) as { sms?: boolean; email?: boolean };
      const consent: Consent = { email: c.email !== false, sms: c.sms === true, basis: c.sms === true ? "written" : "customer", at: new Date().toISOString() };
      const result = await updateClientData(id, (data) => {
        let added = 0;
        let updated = 0;
        for (const row of parsed.rows) {
          if (data.contacts.length >= LIMITS.contacts) break;
          const existing = findContact(data, row.phone, row.email);
          if (existing) {
            existing.lastVisit ??= row.lastVisit;
            existing.interest ??= row.interest;
            if (consent.sms && !existing.optedOutAt) existing.consent = { ...existing.consent, sms: true, basis: "written", at: consent.at };
            updated++;
            continue;
          }
          newContact(data, { name: row.name, phone: row.phone, email: row.email, lastVisit: row.lastVisit, interest: row.interest, notes: row.notes, source: "import", consent: { ...consent, email: consent.email && Boolean(row.email), sms: consent.sms && Boolean(row.phone) } });
          added++;
        }
        return { added, updated };
      });
      return Response.json({ ...result, skipped: parsed.skipped.length, duplicates: parsed.duplicates });
    }
    case "add": {
      const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
      const phone = toE164(typeof b.phone === "string" ? b.phone : undefined, client.country);
      const email = typeof b.email === "string" && EMAIL.test(b.email.trim()) ? b.email.trim().toLowerCase() : undefined;
      if (!phone && !email) throw new HttpError(400, "Add a full phone number (with area code) or an email address");
      const contact = await updateClientData(id, (data) => {
        const existing = findContact(data, phone, email);
        if (existing) return structuredClone(existing);
        return structuredClone(
          newContact(data, {
            name: name || email?.split("@")[0] || phone!,
            phone,
            email,
            notes: typeof b.notes === "string" ? b.notes.slice(0, 500) : undefined,
            source: b.lead ? "manual" : "import",
            consent: { email: Boolean(email), sms: b.sms === true && Boolean(phone), basis: b.sms === true ? "written" : "customer", at: new Date().toISOString() },
          })
        );
      });
      if (b.jobDone) await markJobsDone(client, [contact.id]);
      return Response.json({ contact });
    }
    case "test_lead": {
      const r = await captureLead(
        client,
        { name: "Test Lead", email: "test.lead@example.com", message: "Hi, I'd like to book a visit next week. What times do you have?", source: "website" },
        ctx
      );
      return Response.json(r);
    }
    case "jobs_done": {
      const r = await markJobsDone(client, ids);
      void processDue(id, ctx).catch(() => undefined);
      return Response.json(r);
    }
    case "winback": {
      let targets = ids;
      if (b.all === true) {
        // Everyone imported who isn't on a win-back now and hasn't been in for a while.
        const days = Math.max(0, Math.min(3650, Number(b.olderThanDays) || 0));
        const cutoff = Date.now() - days * 86_400_000;
        const data = await readClientData(id);
        targets = data.contacts
          .filter((c) => c.source === "import" && !c.optedOutAt && !c.enrollments.some((e) => e.kind === "reactivation" && !e.stoppedAt) && (!days || !c.lastVisit || Date.parse(c.lastVisit) < cutoff))
          .map((c) => c.id);
      }
      if (!targets.length) throw new HttpError(400, "Nobody to start: import past customers first, or widen the filter");
      const r = await startWinBack(client, targets, typeof b.seqId === "string" ? b.seqId : undefined);
      return Response.json({ ...r, ...(await processDue(id, ctx)) });
    }
    case "update": {
      const cid = typeof b.contactId === "string" ? b.contactId : "";
      if (typeof b.booked === "boolean") return Response.json({ contact: await markBooked(id, cid, b.booked, typeof b.value === "number" ? b.value : undefined) });
      const contact = await updateClientData(id, (data) => {
        const c = data.contacts.find((x) => x.id === cid);
        if (!c) throw new HttpError(404, "Contact not found");
        if (typeof b.notes === "string") c.notes = b.notes.slice(0, 2000);
        if (typeof b.name === "string" && b.name.trim()) c.name = b.name.trim().slice(0, 120);
        if (typeof b.needsHuman === "boolean") c.needsHuman = b.needsHuman;
        if (typeof b.sms === "boolean" && !c.optedOutAt) c.consent = { ...c.consent, sms: b.sms && Boolean(c.phone), basis: b.sms ? "written" : c.consent.basis, at: new Date().toISOString() };
        if (typeof b.email === "boolean" && !c.optedOutAt) c.consent = { ...c.consent, email: b.email && Boolean(c.email) };
        const statuses: ContactStatus[] = ["new", "contacted", "engaged", "lost"];
        if (typeof b.status === "string" && statuses.includes(b.status as ContactStatus)) c.status = b.status as ContactStatus;
        c.updatedAt = new Date().toISOString();
        return structuredClone(c) as Contact;
      });
      return Response.json({ contact });
    }
    case "delete": {
      const gone = new Set(ids);
      await updateClientData(id, (data) => {
        data.contacts = data.contacts.filter((c) => !gone.has(c.id));
        data.messages = data.messages.filter((m) => !gone.has(m.contactId));
      });
      return Response.json({ ok: true, removed: gone.size });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
