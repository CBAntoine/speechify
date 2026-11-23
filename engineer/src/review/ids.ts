/**
 * Find the agent and environment IDs. `ant apply` writes them to
 * claude-lock.json; environment variables override the lock file.
 */
import fs from "node:fs";
import path from "node:path";

export const AGENT_FILE = "agents/fortigate-rulebase-review.md";
export const ENVIRONMENT_FILE = "environments/fortigate-review.yaml";

export interface Ids {
  agentId: string;
  environmentId: string;
  source: string;
}

function fromLock(lockPath: string): Partial<Ids> {
  if (!fs.existsSync(lockPath)) return {};
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as { resources?: Record<string, { id?: string }> };
  const resources = lock.resources ?? {};
  const find = (suffix: string) => {
    for (const [key, value] of Object.entries(resources)) {
      if (key.replace(/\\/g, "/").endsWith(suffix) && typeof value?.id === "string") return value.id;
    }
    return undefined;
  };
  return { agentId: find(AGENT_FILE), environmentId: find(ENVIRONMENT_FILE), source: lockPath };
}

export function loadIds(baseDir: string, env: Record<string, string | undefined> = process.env): Ids | { error: string } {
  const lockPaths = [path.join(baseDir, "claude-lock.json"), path.join(process.cwd(), "claude-lock.json")];
  let lock: Partial<Ids> = {};
  for (const p of lockPaths) {
    lock = fromLock(p);
    if (lock.agentId || lock.environmentId) break;
  }
  const agentId = env.FGT_REVIEW_AGENT_ID || lock.agentId;
  const environmentId = env.FGT_REVIEW_ENVIRONMENT_ID || lock.environmentId;
  if (agentId && environmentId) {
    const source = env.FGT_REVIEW_AGENT_ID || env.FGT_REVIEW_ENVIRONMENT_ID ? "environment variables" : (lock.source ?? "claude-lock.json");
    return { agentId, environmentId, source };
  }
  return {
    error:
      "No agent yet. From the engineer folder, run:\n" +
      `  ant apply ${AGENT_FILE} ${ENVIRONMENT_FILE}\n` +
      "or set FGT_REVIEW_AGENT_ID and FGT_REVIEW_ENVIRONMENT_ID.",
  };
}
