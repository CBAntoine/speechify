/** The small ElevenLabs REST client and saved IDs the voice scripts share. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "voice-agent.json");
const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

/** voice-agent.json: the agent, its voice, and the IDs of its tools and tests (not secret; commit it). */
export interface Saved {
  agent_id?: string;
  voice_id?: string;
  tool_ids?: Record<string, string>;
  test_ids?: Record<string, string>;
  synced_at?: string;
}

export function readSaved(): Saved {
  return fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as Saved) : {};
}

export function writeSaved(saved: Saved): void {
  fs.writeFileSync(FILE, `${JSON.stringify(saved, null, 2)}\n`);
}

export class ElevenError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requireKey(): void {
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error("Set ELEVENLABS_API_KEY first.");
    process.exit(1);
  }
}

export async function eleven<T>(method: "GET" | "POST" | "PATCH" | "PUT", route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    throw new ElevenError(`ElevenLabs ${method} ${route} failed (${res.status}): ${detail}`, res.status);
  }
  return data;
}

export function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
