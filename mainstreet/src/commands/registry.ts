import type { CommandResult } from "../types.ts";
import { errorMessage } from "../util.ts";

// One registry of typed commands drives the dashboard buttons, Atlas's voice
// tools and the MCP endpoint, so all three can do exactly the same things
// with the same checks. Parameters are declared once and produce both the
// validator (forgiving of what voice LLMs send, like "5" or "yes") and the
// JSON schema the tools need.

export type Risk = "read" | "write" | "confirm";
export type Via = "dashboard" | "voice" | "phone" | "mcp";

export interface Param {
  type: "string" | "number" | "integer" | "boolean";
  description: string;
  enum?: readonly string[];
  required?: boolean;
}

export interface CommandDef {
  name: string;
  description: string;
  risk: Risk;
  /** Typically takes more than ~8 seconds: Atlas says something first. */
  slow?: boolean;
  /** Only the dashboard handles it (e.g. navigation). Never runs on the server. */
  clientOnly?: boolean;
  params: Record<string, Param>;
  /** For risk "confirm": what Atlas reads back before doing it, or undefined when these args need no yes. */
  confirm?: (args: Args) => string | undefined | Promise<string | undefined>;
  run: (args: Args, ctx: { via: Via }) => Promise<CommandResult>;
}

export type Args = Record<string, string | number | boolean | undefined>;

const registry = new Map<string, CommandDef>();

export function defineCommand(def: CommandDef): void {
  if (def.risk === "confirm") def.params.confirmed ??= { type: "boolean", description: "True only after the owner explicitly said yes to this exact action." };
  registry.set(def.name, def);
}

export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name);
}

export function listCommands(): CommandDef[] {
  return [...registry.values()];
}

/** JSON Schema for one command's arguments (MCP inputSchema, dashboard forms). */
export function jsonSchema(def: CommandDef): { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false } {
  const properties: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(def.params)) properties[k] = { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
  return { type: "object", properties, required: Object.entries(def.params).filter(([, p]) => p.required).map(([k]) => k), additionalProperties: false };
}

function coerce(p: Param, v: unknown): { ok: true; value: string | number | boolean | undefined } | { ok: false; error: string } {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  if (p.type === "boolean") {
    if (typeof v === "boolean") return { ok: true, value: v };
    const s = String(v).trim().toLowerCase();
    if (["true", "yes", "y", "1", "on"].includes(s)) return { ok: true, value: true };
    if (["false", "no", "n", "0", "off"].includes(s)) return { ok: true, value: false };
    return { ok: false, error: "should be true or false" };
  }
  if (p.type === "number" || p.type === "integer") {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(n)) return { ok: false, error: "should be a number" };
    return { ok: true, value: p.type === "integer" ? Math.round(n) : n };
  }
  const s = String(v).trim();
  if (p.enum) {
    const hit = p.enum.find((e) => e.toLowerCase() === s.toLowerCase() || e.replace(/_/g, " ").toLowerCase() === s.toLowerCase());
    if (!hit) return { ok: false, error: `should be one of: ${p.enum.join(", ")}` };
    return { ok: true, value: hit };
  }
  return { ok: true, value: s };
}

export function parseArgs(def: CommandDef, raw: unknown): { ok: true; args: Args } | { ok: false; error: string } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const args: Args = {};
  const errors: string[] = [];
  for (const [k, p] of Object.entries(def.params)) {
    const r = coerce(p, input[k]);
    if (!r.ok) errors.push(`${k} ${r.error}`);
    else if (r.value === undefined && p.required) errors.push(`${k} is required`);
    else args[k] = r.value;
  }
  return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true, args };
}

/** Run a command by name. Confirm-level commands answer with needsConfirmation until called again with confirmed: true. */
export async function runCommand(name: string, raw: unknown, ctx: { via: Via; pinOk?: boolean }): Promise<CommandResult> {
  const def = registry.get(name);
  if (!def || def.clientOnly) return { ok: false, say: `I don't have a command called ${name}.` };
  const parsed = parseArgs(def, raw);
  if (!parsed.ok) return { ok: false, say: `I couldn't do that: ${parsed.error}.` };
  const args = parsed.args;
  if (def.risk === "confirm") {
    const summary = await def.confirm?.(args);
    if (summary && args.confirmed !== true) return { ok: false, say: `${summary} Should I go ahead?`, needsConfirmation: { summary } };
    if (summary && ctx.via === "phone" && !ctx.pinOk) {
      return { ok: false, say: "On a phone call I need your PIN before I do anything that sends, spends or approves. What's your PIN?", needsConfirmation: { summary: `${summary} (needs your PIN on calls)` } };
    }
  }
  try {
    return await def.run(args, ctx);
  } catch (err) {
    return { ok: false, say: `That didn't work: ${errorMessage(err)}` };
  }
}
