// Short-lived memo per host, so several checks can share one expensive read (sockets, sshd -T).
// The fixer clears it before re-running a check to verify a fix.

import type { Host } from "./types.ts";

const caches = new WeakMap<Host, Map<string, { at: number; value: Promise<unknown> }>>();

export function memo<T>(host: Host, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  let m = caches.get(host);
  if (!m) {
    m = new Map();
    caches.set(host, m);
  }
  const hit = m.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  m.set(key, { at: now, value });
  value.catch(() => m!.delete(key));
  return value;
}

export function clearHostCache(host: Host): void {
  caches.delete(host);
}
