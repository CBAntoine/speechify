import "server-only";
import { elevenEnabled } from "@/lib/config";
import { mapLimit } from "@/lib/prospecting/audit";
import { deleteKnowledge } from "./guide";
import { deleteAgent } from "./receptionist";

// Deleting leads also deletes the ElevenLabs demo receptionists and AI guides
// built for them, so nothing is left running (or billing) in ElevenLabs. A
// client's live receptionist is never touched.

/** Delete them: agents first, then their documents. Returns how many couldn't be deleted. */
export async function deleteElevenResources(r: { agents: string[]; knowledge: string[] }): Promise<{ deleted: number; failed: number }> {
  if (!elevenEnabled() || (!r.agents.length && !r.knowledge.length)) return { deleted: 0, failed: 0 };
  let failed = 0;
  const run = (fn: () => Promise<void>) =>
    fn().then(
      () => true,
      (err) => {
        console.error("[rainmaker] ElevenLabs cleanup", err);
        failed++;
        return false;
      }
    );
  const a = await mapLimit(r.agents, 4, (id) => run(() => deleteAgent(id)));
  const k = await mapLimit(r.knowledge, 4, (id) => run(() => deleteKnowledge(id)));
  return { deleted: [...a, ...k].filter(Boolean).length, failed };
}
