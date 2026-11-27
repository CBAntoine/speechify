import "server-only";
import { dollars, getOffer, priceOf, recommend } from "@/lib/catalog";
import { generateCampaign, templateCampaign, toCampaign } from "@/lib/claude/ads";
import { describeError } from "@/lib/claude/client";
import { generateOutreach, templateOutreach, type OutreachPitch } from "@/lib/claude/outreach";
import { claudeEnabled, elevenEnabled, resendEnabled } from "@/lib/config";
import { artPrompt, generateArt } from "@/lib/elevenlabs/art";
import { buildDemo, demoPath } from "@/lib/elevenlabs/demo";
import { sendEmail } from "@/lib/email";
import { fulfillOrder } from "@/lib/payments/fulfill";
import { findBusinesses } from "@/lib/prospecting/search";
import { scanReddit } from "@/lib/reddit/scan";
import { addActivity, createDraft, getLead, getProfile, patchCampaign, saveCampaign, saveProspects, updateDraft } from "@/lib/repo";
import { siteUrlStatic } from "@/lib/site";
import { newId, readDb, update } from "@/lib/store";
import type { AutopilotLogLine, AutopilotRun, Draft, Lead } from "@/lib/types";
import { abandonedCheckouts, canAutoSend, dueFollowUps, nextTarget, ordersToFulfill, pickForOutreach } from "./plan";

// One Autopilot run: paid orders first, then follow-ups, then new prospects,
// then personal work (demo agent, outreach, sample ads) for the best of them.
// Runs inside a time budget so it fits a serverless function; whatever it
// doesn't reach, the next run picks up. Two runs never overlap.

const LOCK_MS = 6 * 60_000;
const now = () => new Date().toISOString();

export class AutopilotBusy extends Error {}

export async function runAutopilot(trigger: "cron" | "manual", opts: { base?: string; budgetMs?: number } = {}): Promise<AutopilotRun> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 230_000;
  const left = () => budget - (Date.now() - started);
  const base = opts.base ?? siteUrlStatic();

  const run = await update((db) => {
    if (db.autopilot.lockUntil && Date.parse(db.autopilot.lockUntil) > Date.now()) return null;
    const r: AutopilotRun = { id: newId("ap"), trigger, startedAt: now(), status: "running", lines: [], counts: { found: 0, saved: 0, drafted: 0, demos: 0, ads: 0, sent: 0, fulfilled: 0 } };
    db.autopilot.lockUntil = new Date(Date.now() + LOCK_MS).toISOString();
    db.autopilot.runs.unshift(r);
    return structuredClone(r);
  });
  if (!run) throw new AutopilotBusy("Autopilot is already running. It'll finish in a few minutes.");

  const pending: AutopilotLogLine[] = [];
  const counts = run.counts;
  let flushing: Promise<unknown> = Promise.resolve();
  const flush = () => {
    const lines = pending.splice(0);
    const snapshot = { ...counts };
    flushing = flushing.then(() =>
      update((db) => {
        const r = db.autopilot.runs.find((x) => x.id === run.id);
        if (r) {
          r.lines.push(...lines);
          r.counts = snapshot;
        }
        db.autopilot.lockUntil = new Date(Date.now() + LOCK_MS).toISOString();
      }).catch((err) => console.error("[rainmaker] autopilot log", err))
    );
    return flushing;
  };
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => void flush(), 3000);
  const log = (line: AutopilotLogLine) => {
    pending.push(line);
  };

  let failed = false;
  try {
    const db = await readDb();
    const config = db.autopilot.config;
    const profile = await getProfile();

    // 1. Customers who paid come first.
    if (config.fulfillOrders) {
      for (const o of ordersToFulfill(db.orders)) {
        if (left() < 60_000) break;
        const done = await fulfillOrder(o.id, base);
        const failedSteps = done?.fulfillment?.steps.filter((s) => s.status === "error").length ?? 0;
        counts.fulfilled++;
        log({ kind: failedSteps ? "error" : "fulfill", text: `Onboarded ${o.business ?? o.email ?? o.id} (${o.offerName})${failedSteps ? `: ${failedSteps} step(s) need you` : ""}`, orderId: o.id, leadId: o.leadId });
      }
    }

    // 2. Follow-ups that are due, and checkouts people started but didn't finish.
    if (config.followUps) {
      const fresh = await readDb();
      for (const { lead, step } of dueFollowUps(fresh.leads, fresh.drafts, Date.now())) {
        const s = lead.sequence![step];
        const firstSubject = fresh.drafts.find((d) => d.leadId === lead.id && d.channel === "email" && d.status === "sent")?.subject;
        await createDraft({
          leadId: lead.id,
          channel: "email",
          subject: s.subject || (firstSubject ? `Re: ${firstSubject.replace(/^re:\s*/i, "")}` : `Following up: ${lead.name}`),
          body: s.body,
          rationale: `Follow-up ${step + 1} of ${lead.sequence!.length}, due ${s.dayOffset} days after the first email`,
          createdBy: "agent:autopilot",
        });
        await update((d) => {
          const l = d.leads.find((x) => x.id === lead.id);
          if (l?.sequence?.[step]) l.sequence[step].draftedAt = now();
        });
        counts.drafted++;
        log({ kind: "followup", text: `Drafted follow-up ${step + 1} for ${lead.name}`, leadId: lead.id });
      }
      for (const o of abandonedCheckouts(fresh.orders, Date.now()).filter((x) => !x.nudgedAt)) {
        const offer = getOffer(o.offerId);
        if (!offer || !o.email) continue;
        await createDraft({
          leadId: o.leadId,
          channel: "email",
          to: o.email,
          subject: `Still thinking about ${offer.name}?`,
          body: `Hi ${o.name?.split(" ")[0] || "there"},\n\nYou started signing up for ${offer.name} but didn't finish. If anything was unclear (price, setup, how it works for ${o.business ?? "your business"}), just reply and I'll answer personally.\n\nYou can pick up where you left off here:\n${base ? `${base}/store/${offer.slug}` : `/store/${offer.slug}`}\n\n${profile.ownerName || profile.agencyName}\n${profile.agencyName}${profile.mailingAddress ? `\n${profile.mailingAddress}` : ""}\n\nNot interested? Reply "no" and I won't follow up.`,
          rationale: "They started checkout more than a day ago and didn't pay",
          createdBy: "agent:autopilot",
        });
        await update((d) => {
          const x = d.orders.find((y) => y.id === o.id);
          if (x) x.nudgedAt = now();
        });
        counts.drafted++;
        log({ kind: "followup", text: `Drafted a nudge for ${o.business ?? o.email}, who didn't finish checkout`, orderId: o.id, leadId: o.leadId });
      }
    }

    // Reddit buyers: who asked overnight for what you sell (its own switch, in Find clients → Reddit buyers).
    if (db.reddit?.config.morning && left() > 60_000) {
      try {
        const r = await scanReddit("autopilot", { maxAgeHours: 12 });
        log({ kind: "prospect", text: r.found ? `Reddit: ${r.found} fresh post${r.found === 1 ? "" : "s"} asking for what you sell (${r.added} new). See Find clients → Reddit buyers.` : "Reddit: nobody asked for what you sell overnight." });
        for (const e of r.errors.slice(0, 2)) log({ kind: "error", text: `Reddit ${e}` });
      } catch (err) {
        log({ kind: "error", text: `Reddit scan failed: ${describeError(err)}` });
      }
    }

    // 3. New prospects in the next niche × city.
    if (config.enabled && left() > 90_000) {
      const target = nextTarget(config, profile.targetNiches, db.autopilot.cursor);
      if (!target) {
        log({ kind: "info", text: "No cities set, so no prospecting this run. Add cities in Autopilot settings." });
      } else {
        await update((d) => {
          d.autopilot.cursor = target.nextCursor;
        });
        try {
          const res = await findBusinesses({ niche: target.niche, location: target.city, limit: Math.min(40, config.leadsPerRun * 2), audit: Math.min(15, config.leadsPerRun) });
          counts.found += res.prospects.length;
          const good = res.prospects.filter((p) => !p.savedLeadId && (p.score ?? 0) >= config.minScore && p.source !== "sample").slice(0, config.leadsPerRun);
          const { saved } = good.length ? await saveProspects(good, { createdBy: "agent:autopilot", note: `Found by Autopilot in ${target.city}` }) : { saved: [] as Lead[] };
          counts.saved += saved.length;
          log({ kind: "prospect", text: `Searched ${res.niche.plural} in ${target.city}: ${res.prospects.length} found, ${saved.length} good new leads saved` });
        } catch (err) {
          log({ kind: "error", text: `Search for ${target.niche} in ${target.city} failed: ${describeError(err)}` });
        }
      }
    }

    // 4. Personal work for the best new leads.
    if (config.enabled && (config.draftOutreach || config.buildDemos || config.buildAds)) {
      const fresh = await readDb();
      for (const picked of pickForOutreach(fresh.leads, fresh.drafts, config)) {
        if (left() < 70_000) {
          log({ kind: "info", text: "Out of time for this run; the next run continues where this one stopped." });
          break;
        }
        try {
          await personalize(picked.id, { base, makeArt: config.makeArt, demos: config.buildDemos, outreach: config.draftOutreach, ads: config.buildAds && left() > 150_000 }, counts, log);
        } catch (err) {
          log({ kind: "error", text: `${picked.name}: ${describeError(err)}`, leadId: picked.id });
        }
      }
    }

    // 5. Send what's allowed to go out on its own.
    if (config.autoSend) {
      const fresh = await readDb();
      const today = new Date().toISOString().slice(0, 10);
      let sentToday = fresh.autopilot.sent.day === today ? fresh.autopilot.sent.count : 0;
      const outbox = fresh.drafts.filter((d) => d.status === "pending" && d.createdBy === "agent:autopilot" && d.channel === "email");
      for (const d of outbox) {
        const gate = canAutoSend(d, profile, config, sentToday, resendEnabled());
        if (!gate.ok) {
          if (gate.reason === "Daily send cap reached") break;
          continue;
        }
        try {
          await sendEmail({ to: d.to!, subject: d.subject!, text: d.body, replyTo: profile.email || undefined });
          await updateDraft(d.id, { status: "sent", sentAt: now(), sentVia: "resend", error: undefined });
          sentToday++;
          counts.sent++;
          await update((x) => {
            x.autopilot.sent = { day: today, count: sentToday };
          });
          log({ kind: "send", text: `Sent "${d.subject}" to ${d.to}`, leadId: d.leadId });
        } catch (err) {
          await updateDraft(d.id, { error: describeError(err) });
          log({ kind: "error", text: `Couldn't send to ${d.to}: ${describeError(err)}`, leadId: d.leadId });
        }
      }
      const held = (await readDb()).drafts.filter((d) => d.status === "pending" && d.createdBy === "agent:autopilot").length;
      if (held) log({ kind: "info", text: `${held} message(s) are waiting in your Inbox for approval (texts, calls, and emails that failed a safety check)` });
    }
  } catch (err) {
    failed = true;
    log({ kind: "error", text: `Autopilot stopped: ${describeError(err)}` });
  } finally {
    if (timer) clearInterval(timer);
    timer = undefined;
    await flush();
    await flushing;
  }

  const finished = await update((db) => {
    const r = db.autopilot.runs.find((x) => x.id === run.id);
    if (r) {
      r.status = failed ? "error" : "done";
      r.endedAt = now();
    }
    db.autopilot.lockUntil = undefined;
    return r ? structuredClone(r) : run;
  });
  const c = finished.counts;
  await addActivity({
    kind: "agent",
    agentId: "autopilot",
    text: `Autopilot ${failed ? "stopped early" : "finished"}: ${c.saved} new leads, ${c.demos} demos, ${c.drafted} drafts, ${c.ads} ad campaigns, ${c.sent} emails sent, ${c.fulfilled} orders onboarded`,
  });
  await emailSummary(finished).catch(() => undefined);
  return finished;
}

async function personalize(
  leadId: string,
  opts: { base?: string; makeArt: boolean; demos: boolean; outreach: boolean; ads: boolean },
  counts: AutopilotRun["counts"],
  log: (l: AutopilotLogLine) => void
) {
  let lead = await getLead(leadId);
  if (!lead) return;
  const db = await readDb();
  const profile = db.profile;
  const rec = recommend({ niche: lead.niche, signals: lead.signals }, 1)[0];

  // A demo receptionist built from their website: the strongest free next step.
  let demoUrl: string | undefined;
  if (opts.demos && elevenEnabled() && (lead.website || lead.audit?.reachable)) {
    try {
      const demo = lead.demo ?? (await buildDemo(lead.id, "agent:autopilot"));
      if (!lead.demo) counts.demos++;
      demoUrl = opts.base ? `${opts.base}${demoPath(demo.token)}` : undefined;
      log({ kind: "demo", text: `Built a demo AI receptionist for ${lead.name}${demoUrl ? "" : " (set SITE_URL so emails can link to it)"}`, leadId });
      lead = (await getLead(leadId)) ?? lead;
    } catch (err) {
      log({ kind: "error", text: `Demo for ${lead.name} failed: ${describeError(err)}`, leadId });
    }
  }

  if (opts.outreach) {
    const price = rec ? priceOf(rec.offer, db.store) : undefined;
    const pitch: OutreachPitch = {
      offerName: rec?.offer.name,
      offerPrice: price ? `${dollars(price.monthly, { currency: db.store.currency })}/month` : undefined,
      reason: rec?.reason,
      demoUrl,
    };
    const content = claudeEnabled() ? await generateOutreach(lead, profile, "email", pitch) : templateOutreach(lead, profile, pitch);
    const draft: Draft = await createDraft({ leadId, channel: "email", subject: content.subject, body: content.body, rationale: content.rationale, createdBy: "agent:autopilot" });
    await update((d) => {
      const l = d.leads.find((x) => x.id === leadId);
      if (!l) return;
      l.sequence = content.followUps.map((f) => ({ dayOffset: Math.max(1, f.dayOffset), subject: f.subject, body: f.body }));
      l.nextStep = rec ? `Pitch: ${rec.offer.name}${demoUrl ? " + demo link" : ""}` : "Waiting for approval of first email";
    });
    counts.drafted++;
    log({ kind: "outreach", text: `Wrote a first email for ${lead.name}${draft.to ? "" : " (no email address found: send it by hand or add one)"}${rec ? `, pitching ${rec.offer.name}` : ""}`, leadId });
  }

  if (opts.ads) {
    const brief = {
      leadId,
      businessName: lead.name,
      niche: lead.niche,
      location: lead.city ?? lead.address,
      website: lead.website,
      goal: "Get more phone calls",
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      audit: lead.audit,
      notes: "Sample campaign to show the owner what we'd run for them.",
    };
    const content = claudeEnabled() ? await generateCampaign(brief, profile) : templateCampaign(brief);
    const campaign = await saveCampaign(toCampaign(content, brief, "agent:autopilot"));
    counts.ads++;
    let artNote = "";
    if (opts.makeArt && elevenEnabled()) {
      try {
        const art = await generateArt(
          artPrompt({ businessName: lead.name, niche: lead.niche, location: brief.location, offer: campaign.offer, artPrompt: campaign.creative.artPrompt, palette: campaign.creative.palette, brandColors: lead.audit?.brandColors }, "square"),
          "square"
        );
        await patchCampaign(campaign.id, (c) => {
          c.art = { ...(c.art ?? {}), square: art };
        });
        artNote = " with custom art";
      } catch (err) {
        artNote = ` (art failed: ${describeError(err)})`;
      }
    }
    log({ kind: "ads", text: `Built a sample ad campaign for ${lead.name}${artNote}`, leadId });
  }
}

async function emailSummary(run: AutopilotRun) {
  const db = await readDb();
  if (!db.autopilot.config.emailSummary || !resendEnabled() || !db.profile.email) return;
  const c = run.counts;
  if (!c.saved && !c.drafted && !c.fulfilled && !c.sent) return;
  const pendingCount = db.drafts.filter((d) => d.status === "pending").length;
  await sendEmail({
    to: db.profile.email,
    subject: `Autopilot: ${c.saved} new leads, ${c.drafted} drafts, ${c.fulfilled} orders onboarded`,
    text: [
      `Autopilot ${run.status === "done" ? "finished" : "stopped early"} (${run.trigger}).`,
      "",
      ...run.lines.slice(-40).map((l) => `- ${l.text}`),
      "",
      pendingCount ? `${pendingCount} message(s) are waiting for your approval in the Inbox.` : "Nothing is waiting for approval.",
    ].join("\n"),
  });
}
