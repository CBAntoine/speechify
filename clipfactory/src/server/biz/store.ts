import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_AUTOPILOT, type Account, type AutopilotSettings, type Campaign, type Creator, type Opportunity, type PostRecord, type Suggestion } from "../../lib/biz.ts";
import { WORKSPACE } from "../paths.ts";

// The business data: creators, campaigns, accounts, posts and the autopilot's
// settings, in workspace/business.json. One copy in memory per server process.

export interface BizData {
  creators: Creator[];
  campaigns: Campaign[];
  accounts: Account[];
  posts: PostRecord[];
  autopilot: AutopilotSettings;
  /** Discovery results from the last scout run. */
  suggestions: Suggestion[];
  suggestionsAt?: number;
  /** Tracked creators ranked by the last scout run. */
  opportunities: Opportunity[];
  opportunitiesAt?: number;
  /** Jobs the autopilot started: job ID → creator and campaign. */
  jobs: Record<string, { creatorId: string; campaignId?: string; vodId: string; startedAt: number; posted?: boolean }>;
  status: { lastScanAt?: number; lastStatsAt?: number; lastError?: string; log: { t: number; msg: string; level: "info" | "warn" }[] };
}

const file = () => path.join(WORKSPACE, "business.json");

const empty = (): BizData => ({
  creators: [],
  campaigns: [],
  accounts: [],
  posts: [],
  autopilot: { ...DEFAULT_AUTOPILOT },
  suggestions: [],
  opportunities: [],
  jobs: {},
  status: { log: [] },
});

const g = globalThis as unknown as { __cfBiz?: { data: BizData | null; timer: NodeJS.Timeout | null; listeners: Set<() => void>; mtime: number } };
const st = (g.__cfBiz ??= { data: null, timer: null, listeners: new Set(), mtime: 0 });

const mtimeOf = () => {
  try {
    return fs.statSync(file()).mtimeMs;
  } catch {
    return 0;
  }
};

export function biz(): BizData {
  // Another process (the dashboard, or the autopilot in a terminal) saved since: read its copy.
  if (st.data && !st.timer && mtimeOf() > st.mtime + 1) st.data = null;
  if (st.data) return st.data;
  let data = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<BizData>;
    data = { ...data, ...raw, autopilot: { ...DEFAULT_AUTOPILOT, ...(raw.autopilot ?? {}) }, status: { log: [], ...(raw.status ?? {}) } };
  } catch {
    /* first run */
  }
  st.data = data;
  st.mtime = mtimeOf();
  return data;
}

/** Change the data; it is saved shortly after (and listeners told). */
export function mutate<T>(fn: (d: BizData) => T): T {
  const out = fn(biz());
  schedule();
  return out;
}

function schedule() {
  if (st.timer) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    saveBizNow();
  }, 250);
  for (const l of st.listeners) l();
}

export function saveBizNow() {
  if (!st.data) return;
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st.data, null, 1));
  fs.renameSync(tmp, file());
  st.mtime = mtimeOf();
}

export function onBizChange(fn: () => void): () => void {
  st.listeners.add(fn);
  return () => st.listeners.delete(fn);
}

/** Forget the in-memory copy (tests, or after another process wrote the file). */
export function reloadBiz() {
  st.data = null;
}

export function bizLog(msg: string, level: "info" | "warn" = "info") {
  mutate((d) => {
    d.status.log.push({ t: Date.now(), msg, level });
    if (d.status.log.length > 200) d.status.log.splice(0, d.status.log.length - 200);
  });
  if (process.env.CF_ECHO_LOG) console.log(`[autopilot] ${msg}`);
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export function creatorId(platform: string, handle: string): string {
  return `${platform}:${handle.replace(/^@/, "").trim().toLowerCase()}`;
}
