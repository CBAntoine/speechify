import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL, claudeEnabled } from "@/lib/config";

let client: Anthropic | null = null;

export function claude(): Anthropic {
  if (!claudeEnabled()) throw new Error("Add ANTHROPIC_API_KEY to turn on Claude features");
  client ??= new Anthropic();
  return client;
}

export const MODEL = CLAUDE_MODEL;

/** Server-side refusal fallback: if the model declines for policy reasons,
 * the API retries on a fallback model it picks, inside the same call. */
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export class RefusalError extends Error {}

/** Turn SDK errors into one sentence a user can act on. */
export function describeError(err: unknown): string {
  if (err instanceof RefusalError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to do that. Check the key's workspace and feature access.";
  if (err instanceof Anthropic.NotFoundError) return "Claude couldn't find that resource (model or agent). Check CLAUDE_MODEL and agent setup.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limiting this key. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Claude had a server error. Try again in a moment.";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The request to Claude timed out. Try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the server's internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}
