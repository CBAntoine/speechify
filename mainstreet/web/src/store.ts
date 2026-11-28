// App-wide state: the overview, the live crew feed, toasts and dialogs.
// One tiny external store, read with useSyncExternalStore.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, ApiError, getOverview, getSettings } from "./api";
import type { AgentId, AgentStatus, CrewEvent, Me, Overview, SettingsResponse } from "./api";
import { setCurrency } from "./format";

export interface Toast {
  id: number;
  tone: "success" | "info" | "warn" | "error";
  text: string;
  href?: string;
}

export interface DialogField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select";
  placeholder?: string;
  value?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
}

export interface DialogSpec {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: "default" | "danger" | "money";
  fields?: DialogField[];
  resolve: (value: Record<string, string> | null) => void;
}

interface State {
  me: Me | null;
  overview: Overview | null;
  overviewError: string | null;
  events: CrewEvent[]; // newest first
  agents: Partial<Record<AgentId, AgentStatus>>;
  version: number; // bumps when data changed; live screens refetch
  live: boolean; // the event stream is connected
  settings: SettingsResponse | null;
  toasts: Toast[];
  dialog: DialogSpec | null;
}

let state: State = {
  me: null,
  overview: null,
  overviewError: null,
  events: [],
  agents: {},
  version: 0,
  live: false,
  settings: null,
  toasts: [],
  dialog: null,
};

const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getState(): State {
  return state;
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function setMe(me: Me | null) {
  set({ me });
}

// ── Toasts ───────────────────────────────────────────────────────────────

let toastId = 1;
export function toast(tone: Toast["tone"], text: string, href?: string) {
  if (!text) return;
  const t: Toast = { id: toastId++, tone, text, href };
  set({ toasts: [...state.toasts.slice(-3), t] });
  window.setTimeout(() => dismissToast(t.id), tone === "error" ? 7000 : 4500);
}
export function dismissToast(id: number) {
  set({ toasts: state.toasts.filter((t) => t.id !== id) });
}

// ── Dialogs ──────────────────────────────────────────────────────────────

/** Ask a yes/no question. Resolves true on confirm. */
export function confirmDialog(opts: { title: string; body?: string; confirmLabel?: string; tone?: DialogSpec["tone"] }): Promise<boolean> {
  return new Promise((resolve) => {
    set({ dialog: { ...opts, resolve: (v) => resolve(v !== null) } });
  });
}

/** Ask for a few values. Resolves null when cancelled. */
export function formDialog(opts: { title: string; body?: string; confirmLabel?: string; tone?: DialogSpec["tone"]; fields: DialogField[] }): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    set({ dialog: { ...opts, resolve } });
  });
}

export function closeDialog(value: Record<string, string> | null) {
  const d = state.dialog;
  set({ dialog: null });
  d?.resolve(value);
}

// ── Overview, events, crew ───────────────────────────────────────────────

let seenApprovals: Set<string> | null = null;
let seenAlerts: Set<string> | null = null;

export async function loadOverview(): Promise<void> {
  try {
    const o = await getOverview();
    const agents: Partial<Record<AgentId, AgentStatus>> = {};
    for (const a of o.crew) agents[a.id] = a;
    // New approvals and alerts since the last load get a toast.
    if (seenApprovals) {
      for (const a of o.approvals) if (a.status === "pending" && !seenApprovals.has(a.id)) toast("warn", `Needs you: ${a.title}`, "#/approvals");
    }
    if (seenAlerts) {
      for (const a of o.alerts) if (!seenAlerts.has(a.id)) toast(a.level === "error" ? "error" : "warn", a.message);
    }
    seenApprovals = new Set(o.approvals.map((a) => a.id));
    seenAlerts = new Set(o.alerts.map((a) => a.id));
    set({ overview: o, overviewError: null, agents: { ...state.agents, ...agents }, events: mergeEvents(state.events, o.recent) });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    set({ overviewError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadSettings(): Promise<SettingsResponse | null> {
  try {
    const s = await getSettings();
    setCurrency(s.settings.offer?.currency);
    set({ settings: s });
    return s;
  } catch {
    return null;
  }
}

export function setSettings(s: SettingsResponse) {
  setCurrency(s.settings.offer?.currency);
  set({ settings: s });
}

function mergeEvents(current: CrewEvent[], incoming: CrewEvent[]): CrewEvent[] {
  if (!incoming.length) return current;
  const byId = new Map<number, CrewEvent>();
  for (const e of current) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 300);
}

export function pushEvent(e: CrewEvent) {
  set({ events: mergeEvents(state.events, [e]) });
}

export function setAgent(a: AgentStatus) {
  set({ agents: { ...state.agents, [a.id]: a } });
}

let bumpTimer = 0;
/** Something changed on the server: live screens refetch (debounced). */
export function bump(delay = 250) {
  window.clearTimeout(bumpTimer);
  bumpTimer = window.setTimeout(() => set({ version: state.version + 1 }), delay);
}

let overviewTimer = 0;
export function refreshOverviewSoon(delay = 600) {
  window.clearTimeout(overviewTimer);
  overviewTimer = window.setTimeout(() => void loadOverview(), delay);
}

// ── Live stream ──────────────────────────────────────────────────────────

let source: EventSource | null = null;
let retryTimer = 0;
let backoff = 1000;
let everOpened = false;

function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function connectStream() {
  if (source) return;
  const es = new EventSource("/api/stream");
  source = es;
  es.onopen = () => {
    backoff = 1000;
    if (everOpened) {
      void loadOverview();
      bump();
    }
    everOpened = true;
    set({ live: true });
  };
  es.addEventListener("crew-event", (m) => {
    const e = parse<CrewEvent>((m as MessageEvent).data);
    if (e) pushEvent(e);
  });
  es.addEventListener("agent", (m) => {
    const a = parse<AgentStatus>((m as MessageEvent).data);
    if (a) setAgent(a);
  });
  es.addEventListener("lead", (m) => {
    const d = parse<{ id: string; name: string; status: string }>((m as MessageEvent).data);
    if (d?.status === "won") toast("success", `Deal won: ${d.name}`, `#/lead/${d.id}`);
    else if (d?.status === "replied") toast("info", `${d.name} replied`, `#/lead/${d.id}`);
    bump(400);
    refreshOverviewSoon(800);
  });
  es.addEventListener("overview", () => refreshOverviewSoon(400));
  es.onerror = () => {
    es.close();
    source = null;
    set({ live: false });
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(connectStream, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}

export function disconnectStream() {
  window.clearTimeout(retryTimer);
  source?.close();
  source = null;
  set({ live: false });
}

// ── Data hook ────────────────────────────────────────────────────────────

/**
 * Fetch JSON from the API. Keeps the last good data while it reloads, and
 * refetches when the store's version bumps (live) or the path changes.
 */
export function useApi<T>(path: string | null, opts: { live?: boolean } = { live: true }) {
  const version = useStore((s) => s.version);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  const lastPath = useRef(path);
  const live = opts.live !== false;

  useEffect(() => {
    if (!path) return;
    if (lastPath.current !== path) {
      lastPath.current = path;
      setData(null);
    }
    const ctrl = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, live ? version : 0]);

  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
