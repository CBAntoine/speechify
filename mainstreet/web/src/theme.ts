// Light, dark, or follow the system. Saved per browser.

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem("ms-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = read();
const listeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

export function setTheme(t: ThemeChoice) {
  choice = t;
  try {
    if (t === "system") localStorage.removeItem("ms-theme");
    else localStorage.setItem("ms-theme", t);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  apply();
  listeners.forEach((l) => l());
}

export function cycleTheme() {
  setTheme(choice === "system" ? "light" : choice === "light" ? "dark" : "system");
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
  );
}
