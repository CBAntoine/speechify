// Whether the Atlas panel is open, and what to do when it opens. Kept apart
// from the Atlas module so the shell can open it before the voice SDK loads.

import { useSyncExternalStore } from "react";

export type AtlasRequest = { kind: "voice" } | { kind: "text"; prompt: string };

let open = false;
let request: AtlasRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function sub(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function setAtlasOpen(v: boolean) {
  if (open === v) return;
  open = v;
  emit();
}

export function toggleAtlas() {
  setAtlasOpen(!open);
}

/** Open Atlas and start talking right away. */
export function talkToAtlas() {
  request = { kind: "voice" };
  open = true;
  emit();
}

/** Open Atlas with a question, sent as text. */
export function askAtlas(prompt: string) {
  request = { kind: "text", prompt };
  open = true;
  emit();
}

export function takeAtlasRequest(): AtlasRequest | null {
  const r = request;
  request = null;
  return r;
}

export function useAtlasOpen(): boolean {
  return useSyncExternalStore(sub, () => open);
}

export function useAtlasRequest(): AtlasRequest | null {
  return useSyncExternalStore(sub, () => request);
}
