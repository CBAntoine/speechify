// The API keys an owner can save in Settings > API keys instead of (or on
// top of) their hosting's environment variables. A saved key stays until the
// owner presses Remove: it's sealed with AES-256-GCM, stored apart from the
// CRM data, and loaded into the server's environment at startup.
//
// Pure: no Next or storage imports, so it can be unit tested.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type ServiceId = "claude" | "elevenlabs" | "stripe" | "paypal" | "resend" | "places";

export interface ServiceDef {
  id: ServiceId;
  name: string;
  turnsOn: string;
  where: string;
  url: string;
  /** Whether "Check" can test the key with the service. */
  checkable: boolean;
}

export const SERVICES: ServiceDef[] = [
  {
    id: "claude",
    name: "Claude",
    turnsOn: "Writes ads and outreach, researches the web, finds businesses in any town and runs the agents.",
    where: "Claude Console → API keys",
    url: "https://platform.claude.com/settings/keys",
    checkable: true,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    turnsOn: "The copilot's voice, the store's sales assistant, demo receptionists, voiceovers and ad art.",
    where: "ElevenLabs → Developers → API keys (give it Agents write access)",
    url: "https://elevenlabs.io/app/developers/api-keys",
    checkable: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    turnsOn: "Card payments and monthly subscriptions in your store.",
    where: "Stripe dashboard → Developers → API keys",
    url: "https://dashboard.stripe.com/apikeys",
    checkable: true,
  },
  {
    id: "paypal",
    name: "PayPal",
    turnsOn: "PayPal payments and subscriptions in your store.",
    where: "developer.paypal.com → Apps & Credentials",
    url: "https://developer.paypal.com/dashboard/applications",
    checkable: true,
  },
  {
    id: "resend",
    name: "Resend (email)",
    turnsOn: "Sends the emails you approve in the Inbox, and Autopilot's summary.",
    where: "resend.com → API Keys, plus a domain you verified",
    url: "https://resend.com/api-keys",
    checkable: true,
  },
  {
    id: "places",
    name: "Google Places",
    turnsOn: "Finds every kind of business in Find clients, with ratings and review counts.",
    where: "Google Cloud → Credentials (enable Places API (New) first)",
    url: "https://console.cloud.google.com/apis/credentials",
    checkable: false,
  },
];

export const KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_MODE",
  "PAYPAL_WEBHOOK_ID",
  "RESEND_API_KEY",
  "RESEND_FROM",
  "GOOGLE_PLACES_API_KEY",
] as const;

export type KeyName = (typeof KEY_NAMES)[number];

export interface KeyDef {
  name: KeyName;
  service: ServiceId;
  label: string;
  /** Secret values are never shown in full, only a masked preview. */
  secret: boolean;
  placeholder: string;
  hint?: string;
  /** Only needed in special cases; shown folded away. */
  optional?: boolean;
  options?: { value: string; label: string }[];
  /** An error message when the value can't be right, else null. */
  validate?: (v: string) => string | null;
}

const startsWith = (prefixes: string[], what: string) => (v: string) => (prefixes.some((p) => v.startsWith(p)) ? null : `${what} start with ${prefixes.join(", ")}.`);

export const KEY_DEFS: KeyDef[] = [
  { name: "ANTHROPIC_API_KEY", service: "claude", label: "API key", secret: true, placeholder: "sk-ant-…", validate: startsWith(["sk-ant-"], "Claude API keys") },
  { name: "ELEVENLABS_API_KEY", service: "elevenlabs", label: "API key", secret: true, placeholder: "sk_…" },
  {
    name: "STRIPE_SECRET_KEY",
    service: "stripe",
    label: "Secret key",
    secret: true,
    placeholder: "sk_live_… or rk_live_…",
    hint: "Starts with sk_test_ while you try it out, sk_live_ to take real payments.",
    validate: (v) =>
      /^pk_/.test(v) ? "That's the publishable key (pk_…). Paste the secret key: sk_… or a restricted rk_… key." : startsWith(["sk_live_", "sk_test_", "rk_live_", "rk_test_"], "Stripe secret keys")(v),
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    service: "stripe",
    label: "Webhook signing secret",
    secret: true,
    optional: true,
    placeholder: "whsec_…",
    hint: "Only if you made the webhook in Stripe yourself. Connect webhook in Store & pricing sets this up for you.",
    validate: startsWith(["whsec_"], "Stripe webhook secrets"),
  },
  { name: "PAYPAL_CLIENT_ID", service: "paypal", label: "Client ID", secret: true, placeholder: "A…" },
  { name: "PAYPAL_CLIENT_SECRET", service: "paypal", label: "Secret", secret: true, placeholder: "E…" },
  {
    name: "PAYPAL_MODE",
    service: "paypal",
    label: "Mode",
    secret: false,
    placeholder: "sandbox",
    hint: "Sandbox to test with fake money; Live takes real payments. Use the matching app's credentials.",
    options: [
      { value: "sandbox", label: "Sandbox (testing)" },
      { value: "live", label: "Live (real payments)" },
    ],
    validate: (v) => (v === "sandbox" || v === "live" ? null : "Mode is sandbox or live."),
  },
  {
    name: "PAYPAL_WEBHOOK_ID",
    service: "paypal",
    label: "Webhook ID",
    secret: false,
    optional: true,
    placeholder: "e.g. 1AB23456CD789012E",
    hint: "Only if you made the webhook in PayPal yourself. Connect webhook in Store & pricing sets this up for you.",
    validate: (v) => (/^[A-Z0-9-]{5,64}$/i.test(v) ? null : "A PayPal webhook ID is letters and numbers, like 1AB23456CD789012E."),
  },
  { name: "RESEND_API_KEY", service: "resend", label: "API key", secret: true, placeholder: "re_…", validate: startsWith(["re_"], "Resend API keys") },
  {
    name: "RESEND_FROM",
    service: "resend",
    label: "Send from",
    secret: false,
    placeholder: "Sam Rivera <sam@youragency.com>",
    hint: "An address on a domain you verified in Resend.",
    validate: (v) => (/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(v) || /^[^<>]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(v) ? null : "Use an email address, like sam@youragency.com or Sam Rivera <sam@youragency.com>."),
  },
  { name: "GOOGLE_PLACES_API_KEY", service: "places", label: "API key", secret: true, placeholder: "AIza…" },
];

export function keyDef(name: string): KeyDef | undefined {
  return KEY_DEFS.find((d) => d.name === name);
}

export function serviceDef(id: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id);
}

/** Clean up a pasted value and say what's wrong with it, if anything. */
export function cleanKey(def: KeyDef, raw: unknown): { value: string } | { error: string } {
  if (typeof raw !== "string") return { error: "Paste the value first." };
  // Pasting from a dashboard often brings quotes, "NAME=" or line breaks along.
  let v = raw.trim();
  if (v.startsWith(`${def.name}=`)) v = v.slice(def.name.length + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim();
  if (!v) return { error: "Paste the value first." };
  if (v.length > 1000) return { error: "That's too long to be a key." };
  if (def.secret && /\s/.test(v)) return { error: "Keys don't contain spaces or line breaks. Copy it again." };
  if (def.options) v = v.toLowerCase();
  const err = def.validate?.(v);
  return err ? { error: err } : { value: v };
}

/** What a saved value looks like on screen: never more than a known prefix and the last 4 characters. */
export function mask(value: string, secret = true): string {
  const v = value.trim();
  if (!secret) return v.length > 64 ? `${v.slice(0, 61)}…` : v;
  if (v.length < 12) return "••••";
  const prefix = v.match(/^(sk-ant-(?:api\d\d-|admin\d\d-)?|sk_live_|sk_test_|rk_live_|rk_test_|whsec_|sk_|re_|AIza)/)?.[0] ?? "";
  return `${prefix}••••${v.slice(-4)}`;
}

// ── Sealing ───────────────────────────────────────────────────

export type Kid = "env" | "db";
export type Masters = Partial<Record<Kid, Buffer>>;

/** Encryption key from SECRETS_KEY (any long random string). */
export function deriveMaster(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "rainmaker/saved-keys", "v1", 32));
}

export function newStoredMaster(): string {
  return randomBytes(32).toString("base64url");
}

export function storedMaster(s: string): Buffer | undefined {
  const b = Buffer.from(s, "base64url");
  return b.length === 32 ? b : undefined;
}

/** "v1.<kid>.<iv>.<tag>.<ciphertext>". The key's name is bound in, so sealed values can't be swapped between keys. */
export function seal(name: string, value: string, key: Buffer, kid: Kid): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(name, "utf8"));
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return ["v1", kid, iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function kidOf(sealed: string): Kid | null {
  const [v, kid] = sealed.split(".");
  return v === "v1" && (kid === "env" || kid === "db") ? kid : null;
}

/** The value, or null if it can't be opened with these keys (wrong key, changed SECRETS_KEY or tampering). */
export function unseal(name: string, sealed: string, masters: Masters): string | null {
  const [v, kid, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || (kid !== "env" && kid !== "db") || !iv || !tag || data === undefined) return null;
  const key = masters[kid];
  if (!key) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: 16 });
    d.setAAD(Buffer.from(name, "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Putting saved keys into effect ────────────────────────────

/**
 * What this server process changed in its environment: the value it set for
 * each saved key, and the hosting value that was there before, so pressing
 * Remove brings the hosting value back.
 */
export interface EnvLedger {
  applied: Map<string, string>;
  original: Map<string, string | undefined>;
}

export function newLedger(): EnvLedger {
  return { applied: new Map(), original: new Map() };
}

type Env = Record<string, string | undefined>;

/** Saved keys win over hosting values; a key that's no longer saved goes back to the hosting value (or unset). */
export function applySavedKeys(env: Env, saved: Partial<Record<string, string>>, ledger: EnvLedger, names: readonly string[] = KEY_NAMES): void {
  for (const name of names) {
    const ours = ledger.applied.get(name);
    // Changed by someone else since we set it (env files reloaded in dev):
    // that's the new hosting value.
    if (ours !== undefined && env[name] !== ours) ledger.original.set(name, env[name]);
    const want = saved[name];
    if (want !== undefined) {
      if (ours === undefined) ledger.original.set(name, env[name]);
      env[name] = want;
      ledger.applied.set(name, want);
    } else if (ours !== undefined) {
      const back = ledger.original.get(name);
      if (back === undefined) delete env[name];
      else env[name] = back;
      ledger.applied.delete(name);
      ledger.original.delete(name);
    }
  }
}

/** The value the hosting settings give a key, whether or not a saved key overrides it. */
export function hostingValue(env: Env, ledger: EnvLedger, name: string): string | undefined {
  const v = ledger.applied.has(name) ? ledger.original.get(name) : env[name];
  return v || undefined;
}
