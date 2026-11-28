import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import "../commands/index.ts";
import { getCommand, jsonSchema, listCommands, runCommand } from "../commands/registry.ts";
import { APP_PASSWORD, DATA_DIR, DEMO, OWNER_PHONES, eleven as ecfg, features, hasPublicUrl, keys, publicBase } from "../config.ts";
import { proposalUrl, summarize } from "../crew/shared.ts";
import { countByStatus, getLead, getSettings, listApprovals, listEvents, messagesFor, patchSettings, searchLeads } from "../db.ts";
import { bus } from "../events.ts";
import { briefing, overview } from "../insights.ts";
import { NICHES } from "../niches.ts";
import { emailQueue, inbox, oneTapItems } from "../outreach.ts";
import { dailyCap, sentToday } from "../crew/pitcher.ts";
import { browserAvailable } from "../providers/browser.ts";
import { conversationCredential, elevenEnabled } from "../providers/eleven.ts";
import { hasFfmpeg } from "../providers/ffmpeg.ts";
import type { Integrations, LeadStatus, Settings } from "../types.ts";
import { digits, errorMessage, safeEqual } from "../util.ts";
import { atlasAgentId, syncAtlas, toolMode, voiceToolSecret } from "../voice/sync.ts";
import { isAuthed, login, logout, requireOwner, signToken, verifyToken } from "./auth.ts";
import { safeJoin, sendFile } from "./files.ts";

// The dashboard's JSON API (see docs/contracts.md), Atlas's session and
// webhook-tool endpoints, and the owner's file access.

export const api = new Hono();

api.get("/api/me", (c) => {
  const s = getSettings();
  return c.json({ authed: isAuthed(c), passwordRequired: Boolean(APP_PASSWORD), ownerName: s.owner.name, agencyName: s.owner.agencyName, demo: DEMO });
});

api.post("/api/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (!login(c, String(body.password ?? ""))) return c.json({ error: "That password isn't right." }, 401);
  return c.json({ ok: true });
});

api.post("/api/logout", (c) => {
  logout(c);
  return c.json({ ok: true });
});

// Atlas's webhook tools authenticate with their own key, not the cookie.
api.post("/api/voice/tools/:name", async (c) => {
  const key = c.req.header("x-mainstreet-key") ?? "";
  if (!key || !safeEqual(key, voiceToolSecret())) return c.json({ say: "Not authorised." }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const { session_key, caller_id, pin, ...args } = body;
  const browser = verifyToken(typeof session_key === "string" ? session_key : undefined, "voice");
  const caller = digits(String(caller_id ?? ""));
  const knownCaller = caller.length >= 10 && OWNER_PHONES.some((p) => digits(p).endsWith(caller.slice(-10)));
  if (!browser && !knownCaller) return c.json({ ok: false, say: "I can only take orders from the app or from your own phone number." });
  const pinOk = Boolean(keys.voicePin && typeof pin === "string" && safeEqual(digits(pin), digits(keys.voicePin)));
  const r = await runCommand(c.req.param("name"), args, { via: browser ? "voice" : "phone", pinOk });
  return c.json(compact(r));
});

api.use("/api/*", requireOwner);
api.use("/files/*", requireOwner);

api.get("/api/overview", (c) => c.json(overview()));

api.get("/api/leads", (c) => {
  const q = c.req.query();
  const { leads, total } = searchLeads({ status: q.status as LeadStatus | undefined, q: q.q || undefined, limit: Math.min(Number(q.limit ?? 50), 200), offset: Number(q.offset ?? 0) });
  return c.json({ leads: leads.map(summarize), total, counts: countByStatus() });
});

api.get("/api/leads/:id", (c) => {
  const lead = getLead(c.req.param("id"));
  if (!lead) return c.json({ error: "No such lead." }, 404);
  const t = lead.proposalToken;
  return c.json({
    lead: {
      ...lead,
      proposalUrl: proposalUrl(lead),
      liveUrl: lead.liveSlug ? `${publicBase()}/live/${lead.liveSlug}/` : undefined,
      files: {
        variants: (lead.variants ?? []).map((v) => ({ id: v.id, label: v.label, url: t ? `/p/${t}/site/${v.id}/` : `/files/${v.path}`, thumb: v.screenshot ? `/files/${v.screenshot}` : undefined })),
        video: lead.video ? { url: `/files/${lead.video.path}`, poster: `/files/${lead.video.poster}` } : undefined,
        heroImage: lead.heroImage ? `/files/${lead.heroImage}` : undefined,
      },
    },
    messages: messagesFor(lead.id),
    events: listEvents({ leadId: lead.id, limit: 100 }),
  });
});

api.get("/api/approvals", (c) => {
  const status = c.req.query("status") as "pending" | "approved" | "rejected" | undefined;
  return c.json({ approvals: listApprovals(status || undefined, 100) });
});

api.get("/api/outreach", (c) => c.json({ cap: dailyCap(), sentToday: sentToday(), scheduled: emailQueue(), oneTap: oneTapItems(40), inbox: inbox(40) }));

api.get("/api/events", (c) => {
  const q = c.req.query();
  return c.json({ events: listEvents({ before: q.before ? Number(q.before) : undefined, limit: Number(q.limit ?? 100), agent: q.agent || undefined }) });
});

let integrationsCache: { at: number; value: Pick<Integrations, "ffmpeg" | "browser"> } | undefined;

async function integrations(): Promise<Integrations> {
  if (!integrationsCache || Date.now() - integrationsCache.at > 60_000) {
    const [ff, br] = await Promise.all([hasFfmpeg(), browserAvailable()]);
    integrationsCache = { at: Date.now(), value: { ffmpeg: ff, browser: br.ok } };
  }
  return {
    claude: features.claude,
    googlePlaces: features.places,
    elevenlabs: elevenEnabled(),
    elevenImages: elevenEnabled(),
    resend: features.resend,
    stripe: features.stripe,
    voiceAgent: { configured: Boolean(atlasAgentId()), agentId: atlasAgentId(), toolMode: toolMode() },
    publicUrl: hasPublicUrl() ? publicBase() : undefined,
    ...integrationsCache.value,
  };
}

api.get("/api/settings", async (c) => c.json({ settings: getSettings(), integrations: await integrations(), niches: NICHES.map((n) => ({ id: n.id, label: n.label })) }));

api.patch("/api/settings", async (c) => {
  const patch = (await c.req.json().catch(() => ({}))) as Partial<Settings>;
  delete (patch as { crew?: unknown }).crew; // pause/resume go through commands, so they're logged
  return c.json({ settings: patchSettings(patch) });
});

api.get("/api/commands", (c) =>
  c.json({ commands: listCommands().map((d) => ({ name: d.name, description: d.description, risk: d.risk, slow: Boolean(d.slow), clientOnly: Boolean(d.clientOnly), params: jsonSchema(d) })) }),
);

api.post("/api/commands/:name", async (c) => {
  const def = getCommand(c.req.param("name"));
  if (!def) return c.json({ ok: false, say: "No such command." }, 404);
  const args = await c.req.json().catch(() => ({}));
  const via = c.req.header("x-via") === "voice" ? "voice" : "dashboard";
  return c.json(compact(await runCommand(def.name, args, { via })));
});

function compact<T extends { data?: unknown }>(r: T): T {
  const json = JSON.stringify(r.data ?? null);
  if (json.length <= 12_000) return r;
  return { ...r, data: { note: "Trimmed for length; ask for something narrower.", preview: json.slice(0, 11_000) } };
}

// ── Atlas sessions ───────────────────────────────────────────────────────

api.get("/api/voice/status", (c) => {
  const id = atlasAgentId();
  return c.json({ configured: Boolean(id && elevenEnabled()), agentId: id, toolMode: toolMode(), talkUrl: id ? `https://elevenlabs.io/app/agents/agents/${id}` : undefined, keyPresent: elevenEnabled(), phoneNumber: Boolean(ecfg.phoneNumberId) });
});

api.post("/api/voice/sync", async (c) => {
  if (!elevenEnabled()) return c.json({ ok: false, error: "Add ELEVENLABS_API_KEY to .env first." }, 400);
  try {
    return c.json({ ok: true, ...(await syncAtlas()) });
  } catch (err) {
    return c.json({ ok: false, error: errorMessage(err) }, 502);
  }
});

api.post("/api/voice/session", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "text" ? "text" : "voice";
  if (!elevenEnabled()) return c.json({ ok: false, error: "Add ELEVENLABS_API_KEY to .env to talk to Atlas." });
  const agentId = atlasAgentId();
  if (!agentId) return c.json({ ok: false, error: "Atlas isn't set up yet. Open Settings → Voice and press Sync Atlas." });
  try {
    const auth = await conversationCredential(agentId, mode);
    const s = getSettings();
    const b = briefing();
    return c.json({
      ok: true,
      auth,
      dynamicVariables: {
        owner_name: s.owner.name?.split(" ")[0] || "there",
        agency_name: s.owner.agencyName,
        today: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: s.owner.timezone }),
        briefing_line: b.line,
        where: `in the Mainstreet app, by ${mode === "voice" ? "voice" : "text"}${DEMO ? " (demo mode: the businesses are fictional and nothing is really sent)" : ""}`,
        session_key: signToken("voice", 2 * 3600),
        call_reason: "",
        briefing: b.text,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: errorMessage(err) });
  }
});

// ── Live updates ─────────────────────────────────────────────────────────

api.get("/api/stream", (c) =>
  streamSSE(c, async (stream) => {
    const send = (event: string) => (data: unknown) => void stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
    const handlers: [string, (d: unknown) => void][] = [
      ["crew-event", send("crew-event")],
      ["lead", send("lead")],
      ["agent", send("agent")],
      ["overview", send("overview")],
    ];
    for (const [e, h] of handlers) bus.on(e, h);
    const ping = setInterval(() => void stream.write(": ping\n\n").catch(() => undefined), 20_000);
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(ping);
    for (const [e, h] of handlers) bus.off(e, h);
  }),
);

// ── Owner files (mockups, videos, screenshots) ──────────────────────────

api.get("/files/*", (c) => {
  const rel = c.req.path.replace(/^\/files\//, "");
  const file = safeJoin(DATA_DIR, rel);
  return file ? sendFile(c, file, { cache: "private, max-age=60" }) : c.text("Not found", 404);
});
