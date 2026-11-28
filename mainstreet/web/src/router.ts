// A tiny hash router: #/today, #/pipeline?status=ready, #/lead/<id>, …

import { useSyncExternalStore } from "react";

export type ScreenId = "today" | "pipeline" | "lead" | "outreach" | "approvals" | "crew" | "settings" | "activity" | "more";

export interface Route {
  screen: ScreenId;
  param?: string;
  query: URLSearchParams;
  raw: string;
}

const SCREENS: ScreenId[] = ["today", "pipeline", "lead", "outreach", "approvals", "crew", "settings", "activity", "more"];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  const first = (parts[0] ?? "today") as ScreenId;
  const screen = SCREENS.includes(first) ? first : "today";
  return { screen, param: parts[1] ? decodeURIComponent(parts[1]) : undefined, query: new URLSearchParams(queryPart), raw };
}

let current = parseHash(typeof window === "undefined" ? "" : window.location.hash);
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    current = parseHash(window.location.hash);
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function currentRoute(): Route {
  return current;
}

export function href(screen: ScreenId, param?: string, query?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#/${screen}${param ? `/${encodeURIComponent(param)}` : ""}${qs ? `?${qs}` : ""}`;
}

export function navigate(screen: ScreenId, param?: string, query?: Record<string, string | undefined>): void {
  const next = href(screen, param, query);
  if (window.location.hash === next) return;
  window.location.hash = next;
}

export const SCREEN_LABEL: Record<ScreenId, string> = {
  today: "Today",
  pipeline: "Pipeline",
  lead: "Lead",
  outreach: "Outreach",
  approvals: "Approvals",
  crew: "Crew",
  settings: "Settings",
  activity: "Activity",
  more: "More",
};
