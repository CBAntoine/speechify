// Every dashboard action runs a command — the same registry Atlas and the
// MCP endpoint use (docs/contracts.md → "Commands").

import { postCommand } from "./api";
import type { CommandResult } from "./api";
import { bump, confirmDialog, refreshOverviewSoon, toast } from "./store";

export type CommandName =
  | "get_briefing"
  | "get_metrics"
  | "find_leads"
  | "get_lead"
  | "list_approvals"
  | "decide_approval"
  | "run_agent"
  | "pause_crew"
  | "resume_crew"
  | "update_setting"
  | "add_target"
  | "remove_target"
  | "send_pitch"
  | "send_reply"
  | "draft_reply"
  | "log_outcome"
  | "add_note"
  | "add_lead"
  | "rebuild"
  | "get_activity"
  | "get_spend"
  | "get_call_list"
  | "open_screen";

export type Risk = "read" | "write" | "confirm" | "browser";

export const COMMAND_RISK: Record<CommandName, Risk> = {
  get_briefing: "read",
  get_metrics: "read",
  find_leads: "read",
  get_lead: "read",
  list_approvals: "read",
  decide_approval: "confirm",
  run_agent: "write",
  pause_crew: "write",
  resume_crew: "write",
  update_setting: "confirm",
  add_target: "write",
  remove_target: "write",
  send_pitch: "confirm",
  send_reply: "confirm",
  draft_reply: "write",
  log_outcome: "write",
  add_note: "write",
  add_lead: "write",
  rebuild: "write",
  get_activity: "read",
  get_spend: "read",
  get_call_list: "read",
  open_screen: "browser",
};

/** Every command Atlas can call, in a fixed order (client tools are registered from this list). */
export const COMMAND_NAMES = Object.keys(COMMAND_RISK) as CommandName[];

export interface RunOptions {
  /** Ask first in the dashboard, then send confirmed: true. */
  confirm?: { title: string; body?: string; confirmLabel?: string; tone?: "default" | "danger" | "money" };
  /** No toast on success (the screen shows the change itself). */
  quiet?: boolean;
}

/**
 * Run a command from a button. Handles the confirm round-trip: if the server
 * still wants a yes, it shows the server's own summary and asks.
 */
export async function run(name: CommandName, args: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<CommandResult> {
  let confirmed = false;
  if (opts.confirm) {
    const yes = await confirmDialog(opts.confirm);
    if (!yes) return { ok: false, say: "Cancelled." };
    confirmed = true;
  }
  let res = await postCommand(name, confirmed ? { ...args, confirmed: true } : args);
  if (!res.ok && res.needsConfirmation) {
    const yes = await confirmDialog({ title: "Please confirm", body: res.needsConfirmation.summary, confirmLabel: "Yes, go ahead" });
    if (!yes) return { ok: false, say: "Cancelled." };
    res = await postCommand(name, { ...args, confirmed: true });
  }
  if (res.ok) {
    if (!opts.quiet) toast("success", res.say || "Done.");
  } else {
    toast("error", res.say || "That didn't work.");
  }
  if (COMMAND_RISK[name] !== "read") {
    bump(150);
    refreshOverviewSoon(500);
  }
  return res;
}
