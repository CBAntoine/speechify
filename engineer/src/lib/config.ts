import "server-only";
import voiceAgent from "../../voice-agent.json";
import { loadIds, type Ids } from "@/review/ids.ts";

// Settings come from environment variables; see the README for the list.

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const elevenEnabled = () => Boolean(process.env.ELEVENLABS_API_KEY);

/** The engineer voice agent in ElevenLabs. */
export function voiceAgentId(): string | null {
  return process.env.ELEVENLABS_AGENT_ID || (voiceAgent as { agent_id?: string }).agent_id || null;
}

/** The review agent and its sandbox, from FGT_REVIEW_* variables or claude-lock.json. */
export function reviewAgent(): Ids | null {
  const ids = loadIds(process.cwd());
  return "error" in ids ? null : ids;
}

/** Spending cap for each review, at list price. */
export function budgetCents(): number {
  const usd = Number(process.env.REVIEW_BUDGET_USD ?? 5);
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 100) : 500;
}

export function consoleUrl(sessionId: string): string {
  return `https://platform.claude.com/workspaces/${process.env.ANTHROPIC_CONSOLE_WORKSPACE || "default"}/sessions/${sessionId}`;
}
