import { Console } from "@/components/Console";
import { budgetCents, claudeEnabled, elevenEnabled, reviewAgent, voiceAgentId } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const voiceUnavailable = !elevenEnabled()
    ? "Voice isn't set up: add ELEVENLABS_API_KEY to the console's environment."
    : !voiceAgentId()
      ? "The engineer agent isn't set up: run npm run voice:sync."
      : null;
  const reviewsUnavailable = !claudeEnabled()
    ? "Reviews need ANTHROPIC_API_KEY in the console's environment."
    : !reviewAgent()
      ? "Reviews need the review agent: run ant apply in the engineer folder (see the README), or set FGT_REVIEW_AGENT_ID and FGT_REVIEW_ENVIRONMENT_ID."
      : null;
  const changesUnavailable = claudeEnabled() ? null : "Change drafts need ANTHROPIC_API_KEY in the console's environment.";
  return <Console voiceUnavailable={voiceUnavailable} reviewsUnavailable={reviewsUnavailable} changesUnavailable={changesUnavailable} budgetUsd={budgetCents() / 100} />;
}
