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

export interface Integrations {
  claude: boolean;
  model: string;
  agentRuntime: "managed" | "messages" | "demo";
  googlePlaces: boolean;
  resend: boolean;
  runBudgetUsd: number;
}

export function integrations(): Integrations {
  return {
    claude: claudeEnabled(),
    model: CLAUDE_MODEL,
    agentRuntime: agentRuntime(),
    googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    resend: resendEnabled(),
    runBudgetUsd: runBudgetCents() / 100,
  };
}
