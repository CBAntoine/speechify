// Typed calls to the Mainstreet server (docs/contracts.md → "Dashboard API").

import type {
  Approval,
  CommandResult,
  CrewEvent,
  Integrations,
  Lead,
  LeadStatus,
  LeadSummary,
  Message,
  Overview,
  Settings,
  VariantId,
} from "../../src/types.ts";

export type * from "../../src/types.ts";

export interface Me {
  authed: boolean;
  passwordRequired: boolean;
  ownerName: string;
  agencyName: string;
  demo: boolean;
}

export type LeadDetail = Lead & {
  proposalUrl?: string;
  files: {
    variants: { id: VariantId; label: string; url: string; thumb?: string }[];
    video?: { url: string; poster: string };
    heroImage?: string;
  };
};

export interface LeadsResponse {
  leads: LeadSummary[];
  total: number;
  counts: Partial<Record<LeadStatus, number>>;
}

export interface LeadResponse {
  lead: LeadDetail;
  messages: Message[];
  events: CrewEvent[];
}

export interface ScheduledItem {
  leadId: string;
  leadName: string;
  subject: string;
  status: Message["status"];
  sendAfter?: string;
  messageId: string;
}

export interface OneTapItem {
  leadId: string;
  leadName: string;
  channel: "call" | "sms" | "dm";
  href: string;
  text: string;
  done: boolean;
}

export interface InboxItem extends Message {
  leadName: string;
}

export interface OutreachResponse {
  cap: number;
  sentToday: number;
  scheduled: ScheduledItem[];
  oneTap: OneTapItem[];
  inbox: InboxItem[];
}

export interface SettingsResponse {
  settings: Settings;
  integrations: Integrations;
  niches: { id: string; label: string }[];
}

export interface CommandInfo {
  name: string;
  description: string;
  risk: "read" | "write" | "confirm";
  params: unknown;
}

export interface VoiceStatus {
  configured: boolean;
  agentId?: string;
  toolMode: "client" | "webhook";
  talkUrl?: string;
}

export interface VoiceSyncResult {
  ok: boolean;
  agentId?: string;
  created?: boolean;
  tools?: number;
  error?: string;
}

export type VoiceSession =
  | { ok: true; auth: { conversationToken: string } | { signedUrl: string }; dynamicVariables?: Record<string, string> }
  | { ok: false; error: string };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Fired when the server says the session is gone, so the shell can show the sign-in screen. */
export const AUTH_EVENT = "ms:unauthorized";

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init?.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError("Can't reach the Mainstreet server. Is it running?", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/me")) window.dispatchEvent(new Event(AUTH_EVENT));
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export const getMe = () => api<Me>("/api/me");
export const login = (password: string) => api<{ ok: true }>("/api/login", { body: { password } });
export const logout = () => api<{ ok: true }>("/api/logout", { method: "POST", body: {} });
export const getOverview = () => api<Overview>("/api/overview");
export const getSettings = () => api<SettingsResponse>("/api/settings");
export const patchSettings = (patch: unknown) => api<{ settings: Settings }>("/api/settings", { method: "PATCH", body: patch });
export const getApprovals = (status?: string) => api<{ approvals: Approval[] }>(`/api/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`);
export const getVoiceStatus = () => api<VoiceStatus>("/api/voice/status");
export const syncVoice = () => api<VoiceSyncResult>("/api/voice/sync", { method: "POST", body: {} });

export async function postCommand(name: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
  try {
    return await api<CommandResult>(`/api/commands/${encodeURIComponent(name)}`, { body: stripEmpty(args) });
  } catch (err) {
    return { ok: false, say: err instanceof Error ? err.message : "That didn't work." };
  }
}

/** Drop undefined/null/"" so optional args stay optional on the server. */
export function stripEmpty(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}
