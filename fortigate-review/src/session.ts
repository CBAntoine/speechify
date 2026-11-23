/**
 * Follow a Managed Agents session: print what the agent does, answer any tool
 * call that waits for approval, survive a dropped connection, and download
 * what the agent wrote to /mnt/session/outputs/.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import type Anthropic from "@anthropic-ai/sdk";

export type SessionEvent =
  | Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents
  | Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Decide whether a call that waits for approval may run. */
export type Approver = (call: ToolCall) => Promise<boolean>;

export interface Printer {
  message(text: string): void;
  detail(text: string): void;
  heading(text: string): void;
}

export interface Ending {
  /** end_turn, budget_reached, retries_exhausted, refusal or terminated. */
  stopReason: string;
  /** The grader's last verdict: satisfied, needs_revision, max_iterations_reached, failed or interrupted. */
  outcome: string | null;
}

export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function describeTool(call: { name: string; input: Record<string, unknown> }): string {
  const input = call.input ?? {};
  const key = ["command", "file_path", "path", "pattern"].find((k) => typeof input[k] === "string");
  return `${call.name} ${oneLine(key ? String(input[key]) : JSON.stringify(input), 140)}`;
}

/** Ask the person at the terminal. Without a terminal, decline. */
export const terminalApprover: Approver = async (call) => {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\nClaude wants to run: ${describeTool(call)}\nAllow it? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const isAsk = (ev: SessionEvent): ev is Extract<SessionEvent, { type: "agent.tool_use" | "agent.mcp_tool_use" }> =>
  (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") && ev.evaluated_permission === "ask";

export async function follow(
  client: Anthropic,
  sessionId: string,
  kickoff: () => Promise<void>,
  opts: { approve: Approver; print: Printer; unattended: boolean; retryDelayMs?: number },
): Promise<Ending> {
  const { print } = opts;
  const seen = new Set<string>();
  const confirmed = new Set<string>();
  let outcome: string | null = null;

  // A call counts as answered only once the answer was sent, so a failed send
  // is retried after reconnecting.
  const confirm = async (call: ToolCall) => {
    if (confirmed.has(call.id)) return;
    const allow = await opts.approve(call);
    await client.beta.sessions.events.send(sessionId, {
      events: [
        allow
          ? { type: "user.tool_confirmation", tool_use_id: call.id, result: "allow" }
          : {
              type: "user.tool_confirmation",
              tool_use_id: call.id,
              result: "deny",
              deny_message: opts.unattended
                ? "This run is unattended, so calls that need approval are declined. Continue without it."
                : "The reviewer declined this call. Continue without it.",
            },
      ],
    });
    confirmed.add(call.id);
  };

  /** Show one event, answer it if it waits on us, and return the stop reason once the session stops. */
  const handle = async (ev: SessionEvent): Promise<string | null> => {
    switch (ev.type) {
      case "agent.message": {
        const text = ev.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
        if (text) print.message(text);
        return null;
      }
      case "agent.tool_use":
      case "agent.mcp_tool_use":
        print.detail(`> ${describeTool(ev)}`);
        if (ev.evaluated_permission === "ask") await confirm(ev);
        else if (ev.evaluated_permission === "deny") print.detail("  (blocked as high-risk by the permission check)");
        return null;
      case "agent.tool_result":
        if (ev.is_error) {
          const text = (ev.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join(" ");
          print.detail(`  error: ${oneLine(text, 160)}`);
        }
        return null;
      case "span.outcome_evaluation_start":
        print.heading(`Grading draft ${ev.iteration + 1} against the rubric...`);
        return null;
      case "span.outcome_evaluation_end":
        outcome = ev.result;
        print.heading(`Grade: ${ev.result.replace(/_/g, " ")}`);
        if (ev.explanation) print.detail(oneLine(ev.explanation, 600));
        return null;
      case "session.error":
        print.message(`Session error: ${ev.error.message}`);
        return null;
      case "session.status_idle":
        return ev.stop_reason.type === "requires_action" ? null : ev.stop_reason.type;
      case "session.status_terminated":
        return "terminated";
      default:
        return null;
    }
  };

  const attempts = 5;
  let sent = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // Stream first, then send, so no early event is missed.
    const stream = await client.beta.sessions.events.stream(sessionId);
    if (!sent) {
      await kickoff();
      sent = true;
    } else {
      // Reconnected: read the whole history first, so a call answered while we
      // were away isn't answered twice, then replay what we missed.
      const history: Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent[] = [];
      for await (const ev of client.beta.sessions.events.list(sessionId)) history.push(ev);
      for (const ev of history) if (ev.type === "user.tool_confirmation") confirmed.add(ev.tool_use_id);
      let stopped: string | null = null;
      for (const ev of history) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          await handle(ev);
        } else if (isAsk(ev)) {
          await confirm(ev);
        }
        if (ev.type === "session.status_running") stopped = null;
        if (ev.type === "session.status_idle" && ev.stop_reason.type !== "requires_action") stopped = ev.stop_reason.type;
        if (ev.type === "session.status_terminated") stopped = "terminated";
      }
      if (stopped) return { stopReason: stopped, outcome };
    }
    try {
      for await (const ev of stream) {
        const id = "id" in ev ? ev.id : undefined;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const stopped = await handle(ev);
        if (stopped) return { stopReason: stopped, outcome };
      }
    } catch (err) {
      if (attempt === attempts - 1) throw err;
    }
    print.detail("(connection dropped, reconnecting)");
    await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 1000) * (attempt + 1)));
  }
  throw new Error("Lost the connection to the session. It may still be running; open it in the Console.");
}

/** Download what the agent wrote to /mnt/session/outputs/. Later versions of a file win. */
export async function downloadOutputs(client: Anthropic, sessionId: string, dir: string, retryDelayMs = 2000): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const files: Anthropic.Beta.BetaFileMetadata[] = [];
    for await (const f of client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) files.push(f);
    if (files.length) {
      files.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const saved = new Set<string>();
      for (const f of files) {
        const name = path.basename(f.filename);
        const res = await client.beta.files.download(f.id);
        fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
        saved.add(name);
      }
      return [...saved];
    }
    // Outputs can take a few seconds to appear after the session goes idle.
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }
  return [];
}
