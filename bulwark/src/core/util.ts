import { createHash, randomBytes } from "node:crypto";
import type { ExecSpec } from "./types.ts";

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

export function randomId(bytes = 6): string {
  return randomBytes(bytes).toString("hex");
}

/** Quotes an argument for display. Commands always run without a shell; this is only for showing them. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function displayCommand(spec: ExecSpec): string {
  if (spec.display) return spec.display;
  const env = spec.env ? Object.entries(spec.env).map(([k, v]) => `${k}=${shellQuote(v)} `).join("") : "";
  return env + [spec.cmd, ...spec.args].map(shellQuote).join(" ");
}

/** Runs async jobs with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

export function octal(mode: number): string {
  return "0" + (mode & 0o7777).toString(8).padStart(3, "0");
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** "2026-11-22T15-30-12Z": sortable and safe in file names. */
export function stamp(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
