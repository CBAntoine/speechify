import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { CLAUDE_MODEL, PRICES, features, keys } from "../config.ts";
import { addCost } from "../db.ts";
import type { AgentId } from "../types.ts";
import { errorMessage } from "../util.ts";

// Every crew role that needs judgment makes one structured call here: the
// role's system prompt, the facts, and a Zod schema the answer must match.
// Code, not the model, decides what happens next. That keeps the crew cheap,
// predictable and easy to audit.

let client: Anthropic | undefined;

function sdk(): Anthropic {
  if (!features.claude) throw new ClaudeError("Claude isn't connected. Add ANTHROPIC_API_KEY to .env to turn it on.");
  client ??= new Anthropic({ apiKey: keys.anthropic, maxRetries: 3, timeout: 240_000 });
  return client;
}

export class ClaudeError extends Error {}

/** Server-side refusal fallback: if the model declines on policy grounds, the API retries on a fallback model inside the same call. */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export type Effort = "low" | "medium" | "high" | "xhigh";

/** A rough pre-call estimate the Checker uses before spending. */
export function estimateClaudeUsd(inputTokens: number, outputTokens: number): number {
  const p = PRICES.claude[CLAUDE_MODEL] ?? PRICES.claude["claude-opus-5-5"];
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

function costOf(model: string, u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  const p = PRICES.claude[model] ?? PRICES.claude[CLAUDE_MODEL] ?? PRICES.claude["claude-opus-5-5"];
  const input = (u.input_tokens ?? 0) * p.in + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cacheRead;
  return (input + (u.output_tokens ?? 0) * p.out) / 1_000_000;
}

export async function askStructured<T>(opts: {
  agent: AgentId;
  leadId?: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  effort?: Effort;
  maxTokens?: number;
  label?: string;
}): Promise<T> {
  const res = await sdk().beta.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    ...FALLBACK,
    output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
    // The role prompt is identical on every call, so it's cached.
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
  });
  const usd = costOf(res.model ?? CLAUDE_MODEL, res.usage);
  addCost({
    provider: "anthropic",
    agent: opts.agent,
    leadId: opts.leadId,
    usd,
    units: (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0),
    unit: "tokens",
    note: opts.label,
  });
  if (res.stop_reason === "refusal") throw new ClaudeError("Claude declined this request.");
  if (res.stop_reason === "max_tokens") throw new ClaudeError("Claude ran out of room before finishing. Try again.");
  if (!res.parsed_output) throw new ClaudeError("Claude's answer didn't match the expected format. Try again.");
  return res.parsed_output as T;
}

/** One sentence a person can act on. */
export function describeClaudeError(err: unknown): string {
  if (err instanceof ClaudeError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This Claude API key isn't allowed to do that.";
  if (err instanceof Anthropic.NotFoundError) return `Claude couldn't find the model ${CLAUDE_MODEL}. Check CLAUDE_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limiting this key. The crew will retry shortly.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Claude had a server error. The crew will retry shortly.";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The request to Claude timed out.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`.trim();
  return errorMessage(err);
}

/** Errors worth retrying later rather than marking the lead as failed. */
export function isTransient(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError ||
    (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)
  );
}
