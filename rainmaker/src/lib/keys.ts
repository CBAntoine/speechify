import "server-only";
import { createHash } from "node:crypto";
import { claude, describeError } from "@/lib/claude/client";
import { claudeEnabled, elevenEnabled, paypalEnabled, paypalMode, resendEnabled, stripeEnabled, stripeMode } from "@/lib/config";
import { resolveCopilotAgentId } from "@/lib/elevenlabs/copilot-agent";
import { ElevenError, eleven } from "@/lib/elevenlabs/client";
import { HttpError } from "@/lib/http";
import { KEY_DEFS, SERVICES, cleanKey, keyDef, mask, serviceDef, type KeyName, type ServiceId } from "@/lib/keys-core";
import { accessToken, paypal } from "@/lib/payments/paypal";
import { stripe } from "@/lib/payments/stripe";
import { readDb, removeSecret, saveSecret, savedKeysInfo, update } from "@/lib/store";

// Settings > API keys: what the owner sees (masked) and does (save, remove,
// check). Full values never leave the server.

export interface KeyView {
  name: KeyName;
  service: ServiceId;
  label: string;
  secret: boolean;
  optional: boolean;
  placeholder: string;
  hint?: string;
  options?: { value: string; label: string }[];
  /** Where the value in effect comes from. */
  source: "saved" | "hosting" | "none";
  /** Masked value in effect. */
  preview: string | null;
  savedAt: string | null;
  /** The hosting value a saved key is standing in for; it comes back on Remove. */
  hostingPreview: string | null;
  /** Saved, but it can't be unlocked because SECRETS_KEY changed or was removed. */
  locked: boolean;
}

export interface KeysPolicy {
  /** False on a public deployment without a sign-in password. */
  canSave: boolean;
  reason?: string;
  /** SECRETS_KEY is set, so the encryption key isn't kept next to the keys. */
  ownEncryptionKey: boolean;
}

export function keysPolicy(): KeysPolicy {
  const ownEncryptionKey = Boolean(process.env.SECRETS_KEY?.trim());
  if (process.env.APP_PASSWORD || process.env.NODE_ENV === "development") return { canSave: true, ownEncryptionKey };
  return {
    canSave: false,
    ownEncryptionKey,
    reason: "Turn on the sign-in password first: add APP_PASSWORD in your hosting settings and redeploy. Without it, anyone with your link could change your keys.",
  };
}

export async function listKeys(): Promise<KeyView[]> {
  const info = await savedKeysInfo();
  return KEY_DEFS.map((d) => {
    const savedAt = info.at[d.name] ?? null;
    const locked = info.locked.includes(d.name);
    const hosting = info.hosting[d.name];
    const inEffect = process.env[d.name];
    const source = savedAt && !locked ? "saved" : hosting ? "hosting" : "none";
    return {
      name: d.name,
      service: d.service,
      label: d.label,
      secret: d.secret,
      optional: Boolean(d.optional),
      placeholder: d.placeholder,
      ...(d.hint ? { hint: d.hint } : {}),
      ...(d.options ? { options: d.options } : {}),
      source,
      preview: inEffect ? mask(inEffect, d.secret) : null,
      savedAt,
      hostingPreview: source === "saved" && hosting ? mask(hosting, d.secret) : null,
      locked,
    };
  });
}

/** Names and sources only, for the copilot's snapshot. */
export async function keySummary(): Promise<{ saved_in_rainmaker: string[]; from_hosting: string[]; not_set: string[] }> {
  const keys = await listKeys();
  const label = (k: KeyView) => `${serviceDef(k.service)?.name ?? k.service} ${k.label.toLowerCase()}`;
  return {
    saved_in_rainmaker: keys.filter((k) => k.source === "saved").map(label),
    from_hosting: keys.filter((k) => k.source === "hosting").map(label),
    not_set: keys.filter((k) => k.source === "none" && !k.optional).map(label),
  };
}

const fingerprint = (v: string | undefined) => (v ? createHash("sha256").update(v).digest("hex").slice(0, 16) : "");

/** Claude agents and their sandbox belong to the key's Claude account: with another key, find or make them there. */
async function afterChange(name: KeyName, before: string | undefined) {
  if (fingerprint(before) === fingerprint(process.env[name])) return;
  if (name === "ANTHROPIC_API_KEY") {
    await update((d) => {
      d.managed = { agents: {} };
    });
  }
}

function defFor(name: unknown) {
  const def = typeof name === "string" ? keyDef(name) : undefined;
  if (!def) throw new HttpError(400, "That isn't one of the keys Rainmaker can save.");
  return def;
}

export async function saveKey(name: unknown, raw: unknown): Promise<KeyView[]> {
  const def = defFor(name);
  const r = cleanKey(def, raw);
  if ("error" in r) throw new HttpError(400, r.error);
  const before = process.env[def.name];
  await saveSecret(def.name, r.value);
  await afterChange(def.name, before);
  return listKeys();
}

export async function removeKey(name: unknown): Promise<KeyView[]> {
  const def = defFor(name);
  const before = process.env[def.name];
  await removeSecret(def.name);
  await afterChange(def.name, before);
  return listKeys();
}

// ── Check: does the service accept the key? ───────────────────

export interface CheckResult {
  /** ok: works; fail: rejected or broken; incomplete: something still to add. */
  state: "ok" | "fail" | "incomplete";
  text: string;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** A failed call: the service's own answer, or a plain "couldn't reach it" for network trouble. */
function failed(service: string, err: unknown): CheckResult {
  const network = err instanceof TypeError || (err instanceof Error && /^(AbortError|TimeoutError)$/.test(err.name));
  return { state: "fail", text: network ? `Couldn't reach ${service} from this server (${msg(err)}). Try again in a minute.` : msg(err) };
}

export async function checkService(id: unknown): Promise<CheckResult> {
  const service = typeof id === "string" ? serviceDef(id) : undefined;
  if (!service) throw new HttpError(400, `Pick one of: ${SERVICES.map((s) => s.id).join(", ")}`);
  switch (service.id) {
    case "claude": {
      if (!claudeEnabled()) return { state: "incomplete", text: "Add the Claude API key first." };
      try {
        await claude().models.list({ limit: 1 });
        return { state: "ok", text: "Claude accepted the key." };
      } catch (err) {
        return err instanceof TypeError ? failed("Claude", err) : { state: "fail", text: describeError(err) };
      }
    }
    case "elevenlabs": {
      if (!elevenEnabled()) return { state: "incomplete", text: "Add the ElevenLabs API key first." };
      try {
        await eleven("GET", "/v1/convai/agents?page_size=1", undefined, 15_000);
      } catch (err) {
        return failed("ElevenLabs", err);
      }
      const copilot = await resolveCopilotAgentId();
      if (!copilot) return { state: "ok", text: "ElevenLabs accepted the key. Press Create copilot under Connections to set up the copilot." };
      try {
        await eleven("GET", `/v1/convai/agents/${encodeURIComponent(copilot)}`, undefined, 15_000);
        return { state: "ok", text: "ElevenLabs accepted the key, and the copilot is in this workspace." };
      } catch (err) {
        if (err instanceof ElevenError && err.status === 404) return { state: "incomplete", text: "ElevenLabs accepted the key. The copilot isn't in this workspace yet: press Sync copilot under Connections." };
        return { state: "ok", text: `ElevenLabs accepted the key, but the copilot couldn't be checked: ${msg(err)}` };
      }
    }
    case "stripe": {
      if (!stripeEnabled()) return { state: "incomplete", text: "Add the Stripe secret key first." };
      try {
        await stripe("GET", "/products", { limit: 1 });
      } catch (err) {
        return failed("Stripe", err);
      }
      const mode = stripeMode() === "test" ? "test mode: no real money moves" : "live mode";
      const hook = (await readDb()).payments.stripe;
      if (!process.env.STRIPE_WEBHOOK_SECRET && !hook.webhookId) return { state: "incomplete", text: `Stripe accepted the key (${mode}). Next, press Connect webhook in Store & pricing so payments update your pipeline.` };
      if (hook.webhookId && !process.env.STRIPE_WEBHOOK_SECRET) {
        const ok = await stripe("GET", `/webhook_endpoints/${encodeURIComponent(hook.webhookId)}`).then(
          () => true,
          () => false
        );
        if (!ok) return { state: "incomplete", text: `Stripe accepted the key (${mode}), but the saved webhook isn't in this Stripe account or mode. Press Connect webhook in Store & pricing.` };
      }
      return { state: "ok", text: `Stripe accepted the key (${mode}) and the webhook is connected.` };
    }
    case "paypal": {
      if (!paypalEnabled()) return { state: "incomplete", text: "Add both the PayPal client ID and the secret." };
      try {
        await accessToken(true);
      } catch (err) {
        return failed("PayPal", err);
      }
      const mode = paypalMode() === "sandbox" ? "sandbox: test money only" : "live";
      const hookId = process.env.PAYPAL_WEBHOOK_ID || (await readDb()).payments.paypal.webhookId;
      if (!hookId) return { state: "incomplete", text: `PayPal accepted the credentials (${mode}). Next, press Connect webhook in Store & pricing.` };
      const ok = await paypal("GET", `/v1/notifications/webhooks/${encodeURIComponent(hookId)}`).then(
        () => true,
        () => false
      );
      return ok
        ? { state: "ok", text: `PayPal accepted the credentials (${mode}) and the webhook is connected.` }
        : { state: "incomplete", text: `PayPal accepted the credentials (${mode}), but its webhook isn't on this PayPal app. Press Connect webhook in Store & pricing.` };
    }
    case "resend": {
      if (!process.env.RESEND_API_KEY) return { state: "incomplete", text: "Add the Resend API key first." };
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        return failed("Resend", err);
      }
      const data = (await res.json().catch(() => ({}))) as { data?: { name: string; status: string }[]; name?: string; message?: string };
      const from = process.env.RESEND_FROM;
      const domain = from?.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
      if (!res.ok) {
        // A sending-only key can't list domains, which is fine for Rainmaker.
        if (data.name === "restricted_api_key") return resendEnabled() ? { state: "ok", text: "Resend accepted the key (sending only)." } : { state: "incomplete", text: "Resend accepted the key. Add the Send from address too." };
        return { state: "fail", text: `Resend rejected the key: ${data.message ?? `HTTP ${res.status}`}` };
      }
      if (!domain) return { state: "incomplete", text: "Resend accepted the key. Add the Send from address too." };
      const found = data.data?.find((d) => d.name.toLowerCase() === domain);
      if (!found) return { state: "incomplete", text: `Resend accepted the key, but ${domain} isn't one of your Resend domains yet. Add and verify it in Resend.` };
      if (found.status !== "verified") return { state: "incomplete", text: `Resend accepted the key; ${domain} is ${found.status.replace(/_/g, " ")}, not verified yet.` };
      return { state: "ok", text: `Resend accepted the key and ${domain} is verified.` };
    }
    case "places":
      return process.env.GOOGLE_PLACES_API_KEY
        ? { state: "ok", text: "Saved. Find clients uses it on your next search." }
        : { state: "incomplete", text: "Add the Google Places API key first." };
  }
}
