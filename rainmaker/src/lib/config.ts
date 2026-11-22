import "server-only";

export const APP_NAME = "Rainmaker";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function agentRuntime(): "managed" | "messages" | "demo" {
  if (!claudeEnabled()) return "demo";
  return process.env.AGENT_RUNTIME === "messages" ? "messages" : "managed";
}

/** Per-run hard cap for Managed Agents sessions, in US cents. */
export function runBudgetCents(): number {
  const usd = Number(process.env.AGENT_RUN_BUDGET_USD ?? 3);
  return Math.max(50, Math.round((Number.isFinite(usd) ? usd : 3) * 100));
}

export function resendEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

// ── Selling: ElevenLabs, Stripe, PayPal, Autopilot ───────────

/**
 * The storefront's AI sales assistant, already created and tested in this
 * agency's ElevenLabs workspace. It only answers to that workspace's API key.
 * Set ELEVENLABS_SALES_AGENT_ID to use a different one, or press "Sync" in
 * Store & pricing to create one in another workspace.
 */
export const DEFAULT_SALES_AGENT_ID = "agent_2301m80gw6zvekktsm8d0sr9gwe3";

/**
 * The CRM copilot (voice and chat agent that drives the app), created in this
 * agency's ElevenLabs workspace. Set ELEVENLABS_COPILOT_AGENT_ID to use a
 * different one, or press "Sync copilot" in Settings to create one.
 */
export const DEFAULT_COPILOT_AGENT_ID = "agent_6701m80nkwe4ekh9nkkcjbtj81ns";

export function elevenEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function salesAgentId(): string | undefined {
  return process.env.ELEVENLABS_SALES_AGENT_ID || DEFAULT_SALES_AGENT_ID || undefined;
}

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeMode(): "test" | "live" | null {
  const k = process.env.STRIPE_SECRET_KEY;
  if (!k) return null;
  return /^(sk|rk)_test_/.test(k) ? "test" : "live";
}

export function paypalEnabled(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function paypalMode(): "sandbox" | "live" {
  return process.env.PAYPAL_MODE === "live" ? "live" : "sandbox";
}

export interface Integrations {
  claude: boolean;
  model: string;
  agentRuntime: "managed" | "messages" | "demo";
  googlePlaces: boolean;
  resend: boolean;
  runBudgetUsd: number;
  elevenlabs: boolean;
  salesAgent: boolean;
  stripe: boolean;
  stripeMode: "test" | "live" | null;
  paypal: boolean;
  paypalMode: "sandbox" | "live";
  cron: boolean;
}

export function integrations(): Integrations {
  return {
    claude: claudeEnabled(),
    model: CLAUDE_MODEL,
    agentRuntime: agentRuntime(),
    googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    resend: resendEnabled(),
    runBudgetUsd: runBudgetCents() / 100,
    elevenlabs: elevenEnabled(),
    salesAgent: Boolean(salesAgentId()),
    stripe: stripeEnabled(),
    stripeMode: stripeMode(),
    paypal: paypalEnabled(),
    paypalMode: paypalMode(),
    cron: Boolean(process.env.CRON_SECRET),
  };
}
